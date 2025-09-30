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
import requests
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
        data = request.json
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
            px = min(max(int(x * width), 0), width - 1)
            py = min(max(int(y * height), 0), height - 1)
            pixel_points.append([px, py])

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
            # Create visualization overlay
            visualization = img_array.copy()
            color_mask = np.zeros_like(visualization)
            color_mask[mask == 1] = [0, 255, 0]  # Green mask
            visualization = cv2.addWeighted(visualization, 0.5, color_mask, 0.5, 0)

            # Highlight user clicks
            for px, py in pixel_points:
                cv2.circle(visualization, (px, py), 10, (255, 0, 0), -1)

            # Encode visualization as PNG
            vis_buffer = BytesIO()
            Image.fromarray(visualization).save(vis_buffer, format="PNG")
            vis_base64 = base64.b64encode(vis_buffer.getvalue()).decode("utf-8")

            # Encode mask itself as PNG
            mask_img = Image.fromarray((mask * 255).astype(np.uint8))
            mask_buffer = BytesIO()
            mask_img.save(mask_buffer, format="PNG")
            mask_base64 = base64.b64encode(mask_buffer.getvalue()).decode("utf-8")







            ys, xs = np.where(mask == 1)
            if len(xs) > 0 and len(ys) > 0:
                bbox = {
                    "minX": int(xs.min())/ width,
                    "minY": int(ys.min())/height,
                    "maxX": int(xs.max())/width,
                    "maxY": int(ys.max())/height
                }
            else:
                bbox = None

            mask_data.append({
                "score": float(score),
                "mask": mask_base64,
                "visualization": vis_base64,
                "bbox": bbox  # NEW
            })

        return jsonify({
            "status": "success",
            "masks": mask_data,
            "debug": {
                "input_points": input_points,
                "pixel_points": pixel_points,
                "image_size": [width, height]
            }
        })

    except Exception as e:
        return jsonify({
            'error': str(e),
            'type': type(e).__name__
        }), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, threaded=True)


