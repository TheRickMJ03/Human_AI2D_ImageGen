from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import re
import cv2
import numpy as np
import torch
import json
from io import BytesIO
import base64
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from segment_anything import sam_model_registry

# Initialize Flask app
app = Flask(__name__)
CORS(app)


# SAM Model Configuration
sam2_checkpoint = "/home/ram227_njit_edu/SAM/sam2/checkpoints/sam2.1_hiera_large.pt"
model_cfg = "configs/sam2.1/sam2.1_hiera_l.yaml"
device = "cuda" if torch.cuda.is_available() else "cpu"


# Load SAM model
try:
    sam2_model = build_sam2(model_cfg, sam2_checkpoint, device=device)
    predictor = SAM2ImagePredictor(sam2_model)


except Exception as e:
    raise




@app.route('/segment', methods=['POST'])
def segment_with_sam():
    try:
        data = request.get_json()
        image_url = data.get('image_url')
        input_points = data.get('input_points', [])
        input_labels = data.get('input_labels', [])

        # Download and prepare image
        if image_url.startswith("data:image"):
            header, encoded = image_url.split(",", 1)
            img = Image.open(BytesIO(base64.b64decode(encoded))).convert("RGB")
        else:
            response = requests.get(image_url)
            img = Image.open(BytesIO(response.content)).convert("RGB")

        img_array = np.array(img)
        height, width = img_array.shape[:2]

        # Convert normalized coordinates to pixel coordinates
        pixel_points = []
        for point in input_points:
            x, y = point
            # Ensure coordinates are within bounds
            px = min(max(int(x * width), 0), width - 1)
            py = min(max(int(y * height), 0), height - 1)
            pixel_points.append([px, py])

        # Debug visualization - save input points
        debug_img = img_array.copy()
        for px, py in pixel_points:
            cv2.circle(debug_img, (px, py), 10, (0, 255, 0), -1)  # Green dot
            cv2.putText(debug_img, f"({px},{py})", (px+15, py+15),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 1)
        Image.fromarray(debug_img).save("debug_input_points.jpg")

        # Convert to numpy arrays for SAM
        point_coords = np.array(pixel_points)
        point_labels = np.array(input_labels)

        # Predict masks
        predictor.set_image(img_array)
        masks, scores, _ = predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            multimask_output=True
        )

        # Process masks
        mask_data = []
        for i, (mask, score) in enumerate(zip(masks, scores)):
            # Create transparent overlay
            visualization = img_array.copy()
            color_mask = np.zeros_like(visualization)
            color_mask[mask == 1] = [0, 255, 0]  # Green mask

            # Blend with original image
            visualization = cv2.addWeighted(visualization, 0.7, color_mask, 0.3, 0)

            # Highlight the input points
            for px, py in pixel_points:
                cv2.circle(visualization, (px, py), 10, (255, 0, 0), -1)  # Blue dot

            # Convert to PNG
            buffered = BytesIO()
            Image.fromarray(visualization).save(buffered, format="PNG")
            mask_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

            mask_data.append({
                'mask': mask_base64,
                'score': float(score),
                'visualization': mask_base64
            })

        return jsonify({
            'status': 'success',
            'masks': mask_data,
            'debug': {
                'input_points': input_points,
                'pixel_points': pixel_points,
                'image_size': [width, height]
            }
        })

    except Exception as e:
        return jsonify({
            'error': str(e),
            'type': type(e).__name__
        }), 500



if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)
