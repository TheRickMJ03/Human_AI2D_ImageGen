import os
import time
import uuid
import base64
from io import BytesIO
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from huggingface_hub import InferenceClient
from flask_socketio import SocketIO, emit
from PIL import Image
import requests
from google.oauth2 import service_account
import google.auth.transport.requests

load_dotenv()

app = Flask(__name__)
CORS(app) 
socketio = SocketIO(app, cors_allowed_origins="*")  

# Configuration
HF_TOKEN = os.getenv("HF_API_TOKEN") 
MODEL_NAME = "black-forest-labs/FLUX.1-schnell"
INFERENCE_PROVIDER = "together"
GCP_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")

# Initialize client
client = InferenceClient(
    provider=INFERENCE_PROVIDER,
    api_key=HF_TOKEN,
)


def get_access_token_from_service_account():
    
    credentials = service_account.Credentials.from_service_account_file(
        'sa_key.json' ,
        scopes=['https://www.googleapis.com/auth/cloud-platform']
    )
   
    credentials.refresh(google.auth.transport.requests.Request())
    
    return credentials.token


# 🌐 Call Imagen REST API
def call_google_imagen_api(prompt, model_id="imagen-4.0-generate-preview-06-06"):
    endpoint = f"https://us-central1-aiplatform.googleapis.com/v1/projects/{GCP_PROJECT}/locations/us-central1/publishers/google/models/{model_id}:predict"

    headers = {
        "Authorization": f"Bearer {get_access_token_from_service_account()}",
        "Content-Type": "application/json"
    }

    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {
            "sampleCount": 1,
        }
    }

    response = requests.post(endpoint, headers=headers, json=payload)
    if response.status_code != 200:
        raise Exception(f"Google Imagen API error: {response.status_code} - {response.text}")

    image_b64 = response.json()["predictions"][0]["bytesBase64Encoded"]
    return base64.b64decode(image_b64)



#Calls HF's API
def generate_image_with_client(prompt):
    try:
        image = client.text_to_image(
            prompt,
            model=MODEL_NAME,
        )
        return image
    except Exception as e:
        raise Exception(f"Inference failed: {str(e)}")


#Creates directory and stores images locally
def save_image(image):
    os.makedirs("generated_images", exist_ok=True)
    image_id = str(uuid.uuid4())
    image_path = f"generated_images/{image_id}.png"
    image.save(image_path)
    return image_id


#HUGGING FACE
@app.route('/generate', methods=['POST'])
def generate_image():
    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400
        
    data = request.json
    prompt = data.get('prompt')
    model = data.get('model', "black-forest-labs/FLUX.1-schnell")  # Default model
    provider = data.get('provider', "together")  # Default provider
    
    if not prompt:
        return jsonify({'error': 'Prompt required'}), 400
    
    try:
        # Create a temporary client with dynamic provider
        dynamic_client = InferenceClient(
            provider=provider,
            api_key=HF_TOKEN,
        )
        
        # Generate image with specified model
        image = dynamic_client.text_to_image(
            prompt,
            model=model,
        )
        
        # Save and return the image (existing code)
        timestamp = int(time.time())
        safe_prompt = prompt.replace(" ", "_")[:100]
        filename = f"{safe_prompt}__{timestamp}_{uuid.uuid4().hex[:4]}.png"
        image_path = f"generated_images/{filename}"
        image.save(image_path)
        
        socketio.emit('new_image', {
            'id': filename.split('.')[0],
            'url': f"/generated_images/{filename}",
            'prompt': prompt,
            'timestamp': timestamp * 1000,
            'model': model,
            'provider': provider
        })
        
        return jsonify({
            'id': filename.split('.')[0],
            'url': f"/generated_images/{filename}",
            'prompt': prompt,
            'timestamp': timestamp * 1000,
            'model': model,
            'provider': provider
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    

# GOOGLE 
@app.route('/imagen', methods=['POST'])
def generate_imagen():
    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400

    prompt = request.json.get('prompt')
    model = request.json.get('model', "imagen-4.0-generate-preview-06-06")
    size = request.json.get('size', "1024x1024")  

    if not prompt:
        return jsonify({'error': 'Prompt required'}), 400

    try:
        # Get image bytes from Google
        image_bytes = call_google_imagen_api(prompt, model)

        # Convert to PIL image
        image = Image.open(BytesIO(image_bytes)).convert("RGB")

        # Create directory if it doesn't exist
        os.makedirs("generated_images", exist_ok=True)

        # Generate filename with timestamp and UUID
        timestamp = int(time.time())
        safe_prompt = "".join(c for c in prompt if c.isalnum() or c in (' ', '_')).rstrip()
        safe_prompt = safe_prompt[:50].replace(" ", "_")
        filename = f"{safe_prompt}__{timestamp}_{uuid.uuid4().hex[:4]}.png"
        image_path = f"generated_images/{filename}"

        # Save image
        image.save(image_path)

        # Emit socket event if needed
        if 'socketio' in globals():
            socketio.emit('new_image', {
                'id': filename.split('.')[0],
                'url': f"/generated_images/{filename}",
                'prompt': prompt,
                'timestamp': timestamp * 1000
            })

        return jsonify({
            'id': filename.split('.')[0],
            'url': f"/generated_images/{filename}",
            'prompt': prompt,
            'timestamp': timestamp * 1000,
            'size': size,
            'model': model
        })

    except requests.exceptions.HTTPError as http_err:
        error_msg = str(http_err)
        try:
            error_data = http_err.response.json()
            error_msg = error_data.get('error', {}).get('message', error_msg)
        except:
            pass
        return jsonify({'error': f"API request failed: {error_msg}"}), 502
        
    except Exception as e:
        app.logger.error(f"Error generating image: {str(e)}", exc_info=True)
        return jsonify({'error': f"Image generation failed: {str(e)}"}), 500


#OPENAI
@app.route('/save_openai_image', methods=['POST'])
def save_openai_image():
    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400
        
    data = request.json
    image_url = data.get('image_url')
    prompt = data.get('prompt')
    model = data.get('model')
    
    if not all([image_url, prompt, model]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    try:
        # Download the image from OpenAI
        response = requests.get(image_url)
        if response.status_code != 200:
            raise Exception(f"Failed to download image from OpenAI: {response.status_code}")
        
        # Convert to PIL image
        image = Image.open(BytesIO(response.content)).convert("RGB")
        
        # Save with metadata
        os.makedirs("generated_images", exist_ok=True)
        timestamp = int(time.time())
        safe_prompt = "".join(c for c in prompt if c.isalnum() or c in (' ', '_')).rstrip()
        safe_prompt = safe_prompt[:50].replace(" ", "_")
        filename = f"{safe_prompt}__{timestamp}_{uuid.uuid4().hex[:4]}.png"
        image_path = f"generated_images/{filename}"
        image.save(image_path)
        
        # Emit socket event
        socketio.emit('new_image', {
            'id': filename.split('.')[0],
            'url': f"/generated_images/{filename}",
            'prompt': prompt,
            'timestamp': timestamp * 1000,
            'model': model,
            'provider': 'openai'
        })
        
        return jsonify({
            'id': filename.split('.')[0],
            'filename': filename,
            'prompt': prompt,
            'timestamp': timestamp * 1000
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/generated_images/<path:filename>')
def serve_image(filename):
    return send_from_directory("generated_images", filename)




@app.route('/Thumbnails', methods=['GET'])
def list_thumbnails():
    image_dir = "generated_images"
    image_list = []
    
    # Get all files with creation time
    files_with_time = []
    for filename in os.listdir(image_dir):
        if filename.endswith((".png", ".jpg", ".jpeg", ".webp")):
            filepath = os.path.join(image_dir, filename)
            ctime = os.path.getctime(filepath)
            files_with_time.append((filename, ctime))
    
    # Sort by creation time (newest first)
    files_with_time.sort(key=lambda x: x[1], reverse=True)
    
    for filename, timestamp in files_with_time:
        prompt = "N/A"
        if "__" in filename:
            try:
                prompt = filename.split("__")[0].replace("_", " ")
            except:
                pass
                
        image_list.append({
            "id": filename.split(".")[0],
            "url": f"/generated_images/{filename}",
            "prompt": prompt,
            "timestamp": int(timestamp * 1000),  
        })

    return jsonify(image_list)





if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)