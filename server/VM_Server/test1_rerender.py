from share import *
import config
import base64
import io
import cv2
import einops
import gradio as gr
import numpy as np
import torch
import random

from PIL import Image
from flask import request, jsonify, Flask
from pytorch_lightning import seed_everything
from annotator.util import resize_image, HWC3
from annotator.canny import CannyDetector
from cldm.model import create_model, load_state_dict
from cldm.ddim_hacked import DDIMSampler


print("Loading Canny ControlNet model...")
apply_canny = CannyDetector()

model = create_model('./models/cldm_v15.yaml').cpu()
model.load_state_dict(load_state_dict('./models/control_sd15_canny.pth', location='cuda'))
model = model.cuda()
ddim_sampler = DDIMSampler(model)
print("Canny model loaded.")


def base64_to_numpy(base64_string):
    if "," in base64_string:
        base64_string = base64_string.split(',')[1]
    image_data = base64.b64decode(base64_string)
    image = Image.open(io.BytesIO(image_data))
    # Convert to RGBA to keep the alpha channel
    return np.array(image.convert('RGBA'))

def numpy_to_base64(np_array):
    if np_array.shape[2] == 4:
        mode = 'RGBA'
    elif np_array.shape[2] == 3:
        mode = 'RGB'
    else:
        raise ValueError("Input numpy array is not RGB or RGBA")
        
    img = Image.fromarray(np_array.astype('uint8'), mode)
    buffered = io.BytesIO()
    # Save as PNG to support transparency
    img.save(buffered, format="PNG") 
    return "data:image/png;base64," + base64.b64encode(buffered.getvalue()).decode('utf-8')


def process_canny(input_image, prompt, a_prompt, n_prompt, num_samples, image_resolution, ddim_steps, guess_mode, strength, scale, seed, eta, low_threshold, high_threshold):
    with torch.no_grad():
        img = resize_image(HWC3(input_image), image_resolution)
        H, W, C = img.shape

        detected_map = apply_canny(img, low_threshold, high_threshold)
        detected_map = HWC3(detected_map)

        control = torch.from_numpy(detected_map.copy()).float().cuda() / 255.0
        control = torch.stack([control for _ in range(num_samples)], dim=0)
        control = einops.rearrange(control, 'b h w c -> b c h w').clone()

        if seed == -1:
            seed = random.randint(0, 65535)
        seed_everything(seed)

        cond = {"c_concat": [control], "c_crossattn": [model.get_learned_conditioning([prompt + ', ' + a_prompt] * num_samples)]}
        un_cond = {"c_concat": None if guess_mode else [control], "c_crossattn": [model.get_learned_conditioning([n_prompt] * num_samples)]}
        shape = (4, H // 8, W // 8)

        model.control_scales = [strength * (0.825 ** float(12 - i)) for i in range(13)] if guess_mode else ([strength] * 13)
        samples, intermediates = ddim_sampler.sample(ddim_steps, num_samples,
                                                     shape, cond, verbose=False, eta=eta,
                                                     unconditional_guidance_scale=scale,
                                                     unconditional_conditioning=un_cond)

        x_samples = model.decode_first_stage(samples)
        x_samples = (einops.rearrange(x_samples, 'b c h w -> b h w c') * 127.5 + 127.5).cpu().numpy().clip(0, 255).astype(np.uint8)

        results = [x_samples[i] for i in range(num_samples)]
        
        # Return both the generated images and the debug Canny map
        return results, detected_map
app = Flask(__name__)

@app.route('/rerender_with_canny', methods=['POST'])
def rerender_with_canny():
    try:
        data = request.json
        image_base64 = data.get('image_base64')
        prompt = data.get('prompt', "a high-quality, detailed photo")
        
        if not image_base64:
            return jsonify({'error': 'No image data provided'}), 400

        # 1. Get RGBA image and original alpha mask
        input_image_rgba = base64_to_numpy(image_base64)
        original_mask = input_image_rgba[:, :, 3]

        # 2. Create a neutral gray background for Canny
        pil_rgba = Image.fromarray(input_image_rgba, 'RGBA')
        pil_rgb_on_gray = Image.new("RGB", pil_rgba.size, (128, 128, 128))
        pil_rgb_on_gray.paste(pil_rgba, mask=pil_rgba.split()[3]) 
        input_image_rgb_for_canny = np.array(pil_rgb_on_gray)

        results_rgb_list, detected_map_array = process_canny(
            input_image=input_image_rgb_for_canny,
            prompt=prompt,
            a_prompt='best quality, extremely detailed, 8k, isolated object',
            n_prompt='longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, noisy, blurry, landscape, scene, complex background, background',
            num_samples=3,
            image_resolution=512,
            ddim_steps=40,
            guess_mode=False,
            strength=1.0,
            scale=9.0,
            seed=-1,
            eta=0.0,
            low_threshold=50,
            high_threshold=100
        )
        if not results_rgb_list or len(results_rgb_list) == 0:
            return jsonify({'error': 'Failed to generate images'}), 500 

        final_image_options = []
        original_mask_resized = None 

        for generated_rgb in results_rgb_list:
            
            # 5. Get generated image and resize original mask
            if original_mask_resized is None:
                if generated_rgb.shape[0] != original_mask.shape[0] or generated_rgb.shape[1] != original_mask.shape[1]:
                    mask_pil = Image.fromarray(original_mask)
                    mask_pil_resized = mask_pil.resize((generated_rgb.shape[1], generated_rgb.shape[0]), Image.LANCZOS)
                    original_mask_resized = np.array(mask_pil_resized)
                else:
                    original_mask_resized = original_mask
            
            
            # Create a binary mask of the *background* (anywhere alpha is 0)
            inpaint_mask = (original_mask_resized == 0).astype(np.uint8)

            # Use cv2.inpaint to fill the background
            generated_rgb_healed = cv2.inpaint(
                generated_rgb, 
                inpaint_mask, 
                3,  
                cv2.INPAINT_TELEA
            )

            final_rgba = np.dstack((generated_rgb_healed, original_mask_resized))
            final_rgba[original_mask_resized == 0] = [0, 0, 0, 0]

            # 7. Convert to base64 and add to list
            output_image_base64 = numpy_to_base64(final_rgba)
            final_image_options.append(output_image_base64)

        # 8. Convert debug map to base64
        debug_canny_base64 = numpy_to_base64(detected_map_array) 

        return jsonify({
            'image_options': final_image_options, 
            'debug_canny_url': debug_canny_base64
        })

    except Exception as e:
        print(f"Error in /rerender_with_canny: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5003, debug=True) 
