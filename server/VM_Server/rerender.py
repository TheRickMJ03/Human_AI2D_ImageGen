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
from flask import request,jsonify, Flask
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
    return np.array(image.convert('RGB'))

def numpy_to_base64(np_array):
    img = Image.fromarray(np_array.astype('uint8'), 'RGB')
    buffered = io.BytesIO()
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
        return results

app = Flask(__name__)

@app.route('/rerender_with_canny', methods=['POST'])
def rerender_with_canny():
    try:
        # 1. Get the JSON data from the frontend
        data = request.json
        image_base64 = data.get('image_base64')
        prompt = data.get('prompt', "a high-quality, detailed photo")
        
        if not image_base64:
            return jsonify({'error': 'No image data provided'}), 400

        # 2. Convert Base64 string to a NumPy image
        input_image = base64_to_numpy(image_base64)
        print(prompt)
        # 3. Process the image with the Canny model
        results = process_canny(
            input_image=input_image,
            prompt=prompt,
            a_prompt='best quality, extremely detailed',
            n_prompt='longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
            num_samples=1,
            image_resolution=230,
            ddim_steps=20,
            guess_mode=False,
            strength=1.0,
            scale=9.0,
            seed=-1,
            eta=0.0,
            low_threshold=50,
            high_threshold=200
        )
        
        if not results:
            return jsonify({'error': 'Failed to generate image'}), 500

        # 4. Convert the new image (NumPy) back to a Base64 string
        output_image_base64 = numpy_to_base64(results[0])

        # 5. Send the new image back to the React app
        return jsonify({'new_image_url': output_image_base64})

    except Exception as e:
        print(f"Error in /rerender_with_canny: {e}")
        return jsonify({'error': str(e)}), 500



if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5003, debug=True)
