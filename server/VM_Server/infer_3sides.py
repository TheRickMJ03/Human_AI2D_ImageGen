import os
import tyro
import glob
import imageio
import numpy as np
import tqdm
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms.functional as TF
from safetensors.torch import load_file
import rembg

import requests
import base64
from io import BytesIO
from PIL import Image

import kiui
from kiui.op import recenter
from kiui.cam import orbit_camera

from core.options import AllConfigs, Options
from core.models import LGM
from mvdream.pipeline_mvdream import MVDreamPipeline

from flask import Flask, request, jsonify, send_file
import tempfile

app = Flask(__name__)

IMAGENET_DEFAULT_MEAN = (0.485, 0.456, 0.406)
IMAGENET_DEFAULT_STD = (0.229, 0.224, 0.225)

opt = tyro.cli(AllConfigs)

# model
model = LGM(opt)

# resume pretrained checkpoint
if opt.resume is not None:
    if opt.resume.endswith('safetensors'):
        ckpt = load_file(opt.resume, device='cpu')
    else:
        ckpt = torch.load(opt.resume, map_location='cpu')
    model.load_state_dict(ckpt, strict=False)
    print(f'[INFO] Loaded checkpoint from {opt.resume}')
else:
    print(f'[WARN] model randomly initialized, are you sure?')

# device
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model = model.half().to(device)
model.eval()

rays_embeddings = model.prepare_default_rays(device)

tan_half_fov = np.tan(0.5 * np.deg2rad(opt.fovy))
proj_matrix = torch.zeros(4, 4, dtype=torch.float32, device=device)
proj_matrix[0, 0] = 1 / tan_half_fov
proj_matrix[1, 1] = 1 / tan_half_fov
proj_matrix[2, 2] = (opt.zfar + opt.znear) / (opt.zfar - opt.znear)
proj_matrix[3, 2] = - (opt.zfar * opt.znear) / (opt.zfar - opt.znear)
proj_matrix[2, 3] = 1


# load image dream
pipe = MVDreamPipeline.from_pretrained(
    "ashawkey/imagedream-ipmv-diffusers", # remote weights
    torch_dtype=torch.float16,
    trust_remote_code=True,
    # local_files_only=True,
)
pipe = pipe.to(device)

# load rembg
bg_remover = rembg.new_session()

@app.route('/process', methods=['POST'])
def process_image():
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({'error': 'No image data provided'}), 400

        # Extract base64 image data
        image_data = data['image']
        if image_data.startswith('data:image'):
            # Remove data URL prefix if present
            image_data = image_data.split(',')[1]

        # Decode base64 image
        image_bytes = base64.b64decode(image_data)
        image = Image.open(BytesIO(image_bytes)).convert('RGB')

        # Create temporary workspace
        with tempfile.TemporaryDirectory() as tmpdir:
            # Save image to temporary file
            image_path = os.path.join(tmpdir, 'input_image.png')
            image.save(image_path)

            # Process the image
            ply_path = process(opt, image_path, tmpdir)
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()


            if not os.path.exists(ply_path):
                return jsonify({'error': 'PLY file not generated'}), 500

            # Read the PLY file and return as base64
            with open(ply_path, 'rb') as f:
                ply_data = f.read()

            ply_base64 = base64.b64encode(ply_data).decode('utf-8')

            return jsonify({
                'status': 'success',
                'ply_data': ply_base64,
                'filename': 'output.ply'
            })

    except Exception as e:
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
        return jsonify({'error': str(e)}), 500

# process function
def process(opt: Options, path, output_dir=None):
    # Fix: Initialize output_dir properly
    if output_dir is None:
        output_dir = opt.workspace

    name = os.path.splitext(os.path.basename(path))[0]
    print(f'[INFO] Processing {path} --> {name}')

    os.makedirs(output_dir, exist_ok=True)

    input_image = kiui.read_image(path, mode='uint8')

    # bg removal
    carved_image = rembg.remove(input_image, session=bg_remover) 
    mask = carved_image[..., -1] > 0

    # recenter
    image = recenter(carved_image, mask, border_ratio=0.2)

    # generate mv
    image = image.astype(np.float32) / 255.0

    # rgba to rgb white bg
    if image.shape[-1] == 4:
        image = image[..., :3] * image[..., 3:4] + (1 - image[..., 3:4])

    mv_images = []
    mv_images = pipe('', image, guidance_scale=5.0, num_inference_steps=30)
    mv_image = np.stack([mv_images[1], mv_images[2], mv_images[3], mv_images[0]], axis=0)

    # generate gaussians
    input_image = torch.from_numpy(mv_image).permute(0, 3, 1, 2).float().to(device) # [4, 3, 256, 256]
    input_image = F.interpolate(input_image, size=(opt.input_size, opt.input_size), mode='bilinear', align_corners=False)
    input_image = TF.normalize(input_image, IMAGENET_DEFAULT_MEAN, IMAGENET_DEFAULT_STD)

    input_image = torch.cat([input_image, rays_embeddings], dim=1).unsqueeze(0) # [1, 4, 9, H, W]

    with torch.no_grad():
        with torch.autocast(device_type='cuda', dtype=torch.float16):
            # generate gaussians
            gaussians = model.forward_gaussians(input_image)

        # save gaussians
        ply_path = os.path.join(output_dir, name + '.ply')
        model.gs.save_ply(gaussians, ply_path)

    # # Force fancy_video to always be True so that way it gives me the video and the images
    # opt.fancy_video = True

    # # Render individual views first (for images)
    # view_images = []
    # elevation = 0
    # for azi in [0, 90, 180, 270]:
    #     cam_poses = torch.from_numpy(orbit_camera(elevation, azi, radius=opt.cam_radius, opengl=True)).unsqueeze(0).to(device)
    #     cam_poses[:, :3, 1:3] *= -1

    #     cam_view = torch.inverse(cam_poses).transpose(1, 2)
    #     cam_view_proj = cam_view @ proj_matrix
    #     cam_pos = - cam_poses[:, :3, 3]

    #     image = model.gs.render(gaussians, cam_view.unsqueeze(0), cam_view_proj.unsqueeze(0), cam_pos.unsqueeze(0), scale_modifier=1)['image']
    #     view_images.append((image.squeeze(1).permute(0,2,3,1).contiguous().float().cpu().numpy() * 255).astype(np.uint8))

    # # Save individual view images
    # for i, angle in enumerate([0, 90, 180, 270]):
    #     imageio.imwrite(os.path.join(output_dir, f'{name}_view_{angle}.png'), view_images[i][0])

    # # Always render fancy video
    # azimuth = np.arange(0, 720, 4, dtype=np.int32)
    # for azi in tqdm.tqdm(azimuth):
    #     cam_poses = torch.from_numpy(orbit_camera(elevation, azi, radius=opt.cam_radius, opengl=True)).unsqueeze(0).to(device)
    #     cam_poses[:, :3, 1:3] *= -1
    #     cam_view = torch.inverse(cam_poses).transpose(1, 2)
    #     cam_view_proj = cam_view @ proj_matrix
    #     cam_pos = - cam_poses[:, :3, 3]

    #     scale = min(azi / 360, 1)
    #     image = model.gs.render(gaussians, cam_view.unsqueeze(0), cam_view_proj.unsqueeze(0), cam_pos.unsqueeze(0), scale_modifier=scale)['image']
    #     view_images.append((image.squeeze(1).permute(0,2,3,1).contiguous().float().cpu().numpy() * 255).astype(np.uint8))

    # # Save fancy video (only the video frames, not including the individual views)
    # fancy_images = view_images[4:]  # Skip the first 4 frames (individual views)
    # fancy_images_np = np.concatenate(fancy_images, axis=0)
    # imageio.mimwrite(os.path.join(output_dir, name + '.mp4'), fancy_images_np, fps=30)

    return ply_path

# Remove the duplicate code at the bottom and fix the main execution
if __name__ == '__main__':
    # Only run the file processing if test_path is provided (for command line usage)
    if opt.test_path is not None:
        if os.path.isdir(opt.test_path):
            file_paths = glob.glob(os.path.join(opt.test_path, "*"))
        else:
            file_paths = [opt.test_path]
        for path in file_paths:
            process(opt, path)

    # Run Flask app
    app.run(host='0.0.0.0', port=5001)
