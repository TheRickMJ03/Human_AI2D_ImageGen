import os
import time
import uuid
import base64
import cv2
import numpy as np
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
from google import genai
import numpy as np
from PIL import Image
from io import BytesIO
import base64
load_dotenv()


app = Flask(__name__)
CORS(app) 
socketio = SocketIO(app, cors_allowed_origins="*")  

# Configuration
HF_TOKEN = os.getenv("HF_API_TOKEN") 
MODEL_NAME = "black-forest-labs/FLUX.1-schnell"
INFERENCE_PROVIDER = "together"
GCP_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")
VM_KEY = os.getenv("VM_IP_ADDRESS")

hf_client = InferenceClient(
    provider=INFERENCE_PROVIDER,
    api_key=HF_TOKEN,
)

# Client credentials
client_credentials = service_account.Credentials.from_service_account_file(
    'sa_key.json',
    scopes=['https://www.googleapis.com/auth/cloud-platform']
)

client = genai.Client(
    vertexai=True, 
    project=GCP_PROJECT, 
    location='us-central1',
    credentials=client_credentials
)

def get_access_token_from_service_account():
    credentials = service_account.Credentials.from_service_account_file(
        'sa_key.json',
        scopes=['https://www.googleapis.com/auth/cloud-platform']
    )
    credentials.refresh(google.auth.transport.requests.Request())
    return credentials.token



def call_gemini(prompt, image_filename=None, model="gemini-2.0-flash-001"):
    try:
        from google.genai import types
        contents = []


        if image_filename:
            image_path = os.path.join("generated_images", image_filename)
            if not os.path.exists(image_path):
                raise FileNotFoundError(f"Image file {image_path} not found")


            image = Image.open(image_path)
            buffer = BytesIO()
            image.save(buffer, format="PNG")
            buffer.seek(0)


            image_part = types.Part.from_bytes(
                data=buffer.getvalue(),
                mime_type="image/png",
            )
            contents.append(image_part)


        contents.append(prompt)


        config = types.GenerateContentConfig(
                response_modalities=["Text", "Image"],
                candidate_count=1,
        )
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )


        text_response = response.text or ""
        image_bytes = None


        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data:
                image_bytes = part.inline_data.data


        if not image_bytes:
            raise Exception("No image data found in response")


        return {"image_bytes": image_bytes, "text_response": text_response}


    except Exception as e:
        app.logger.error(f"Gemini generation error: {e}", exc_info=True)
        raise
    
SAMVMURL = f"http://{VM_KEY}:5000"
VM_3D_SERVER_URL = f"http://{VM_KEY}:5001"
VM_LAMA_SERVER_URL = f"http://{VM_KEY}:5002" 


def upload_to_vm(filepath, metadata=None):
    try:
        url = "{SAMVMURL}/upload"
        
        with open(filepath, 'rb') as f:
            files = {'file': (os.path.basename(filepath), f)}
            data = metadata or {}
            
            response = requests.post(url, files=files, data=data)
            response.raise_for_status()
            
            return response.json()
    except Exception as e:
        print(f"Upload to VM failed: {str(e)}")
        return None
        
def prepare_3d_input(image_url, mask_data):
    """Prepares the cropped and centered image for 3D generation."""
    # Extract filename from URL
    image_filename = os.path.basename(image_url)
    image_path = os.path.join('generated_images', image_filename)
    
    # Verify image exists
    if not os.path.exists(image_path):
        raise FileNotFoundError('Image file not found for 3D prep')
    
    # Load original image
    with open(image_path, 'rb') as f:
        original_image = Image.open(f).convert('RGBA')
    
    # Decode mask (base64 string)
    if ',' in mask_data:
        mask_data = mask_data.split(',')[-1]
        
    mask_bytes = base64.b64decode(mask_data)
    mask_image = Image.open(BytesIO(mask_bytes)).convert('L')
    
    # Ensure mask matches image size
    if mask_image.size != original_image.size:
        mask_image = mask_image.resize(original_image.size, Image.LANCZOS)
    
    # Create isolated image with only the masked area
    isolated_image = Image.new('RGBA', original_image.size, (0, 0, 0, 0))
    isolated_image.paste(original_image, (0, 0), mask_image)
    
    # Crop to bounding box of the non-transparent pixels
    bbox = isolated_image.getbbox()
    if not bbox:
        raise ValueError('No object found in mask for 3D prep')
        
    cropped = isolated_image.crop(bbox)
    
    # Resize to 256x256 while maintaining aspect ratio
    width, height = cropped.size
    scale = min(256/width, 256/height)
    new_width = int(width * scale)
    new_height = int(height * scale)
    
    resized = cropped.resize((new_width, new_height), Image.LANCZOS)
    
    # Create 256x256 canvas with transparent background
    final_image = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    
    # Center the resized image
    x = (256 - new_width) // 2
    y = (256 - new_height) // 2
    final_image.paste(resized, (x, y))

    final_image.save('debuggg.png')

    # Convert to base64
    buffer = BytesIO()
    final_image.save(buffer, format='PNG', optimize=True)
    final_image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
    
    return f"data:image/png;base64,{final_image_base64}"


@app.route('/transform_to_3d_alive', methods=['POST'])
def transform_to_3d_alive():
    """
    Orchestrates the synchronous inpainting (LaMa) and 3D generation.
    Returns the inpainted image (Image B) and the 3D model (3D_Cat) together.
    """
    try:
        # 1. PARSE INPUT DATA
        data = request.json
        image_url = data['image_url']
        mask_data = data['mask_data'] # Base64 string of the user-drawn mask

        # Retrieve and Encode Original Image
        image_filename = os.path.basename(image_url)
        image_path = os.path.join('generated_images', image_filename)
        if not os.path.exists(image_path):
            return jsonify({'error': 'Image file not found for transformation'}), 404

        # Read the original image file and convert to Base64 for the LaMa API call
        with open(image_path, 'rb') as f:
            original_image_base64 = base64.b64encode(f.read()).decode('utf-8')

        # 2. PROCESS AND DILATE THE MASK
        
        # Handle the data URL prefix (e.g., 'data:image/png;base64,')
        if 'base64,' in mask_data:
            mask_header, mask_b64 = mask_data.split(',', 1)
        else:
            mask_header = 'data:image/png;base64'
            mask_b64 = mask_data

        mask_bytes = base64.b64decode(mask_b64)

        # Convert Base64 mask bytes into a NumPy array for OpenCV processing
        np_arr = np.frombuffer(mask_bytes, np.uint8)
        # Decode the image data into an OpenCV array (IMREAD_UNCHANGED keeps alpha/transparency)
        mask_image_cv = cv2.imdecode(np_arr, cv2.IMREAD_UNCHANGED)

        # Handle different channel configurations (e.g., check for transparency/alpha channel)
        if len(mask_image_cv.shape) > 2 and mask_image_cv.shape[2] == 4:
            # If 4 channels (RGBA), use the alpha channel (index 3) as the mask
            mask_gray = mask_image_cv[:, :, 3]
        elif len(mask_image_cv.shape) > 2:
            # If 3 channels (BGR), convert to grayscale
            mask_gray = cv2.cvtColor(mask_image_cv, cv2.COLOR_BGR2GRAY)
        else:
            # Already a single channel (grayscale)
            mask_gray = mask_image_cv

        # Binarize the mask (anything > 1 becomes 255/white) for dilation
        _, binary_mask = cv2.threshold(mask_gray, 1, 255, cv2.THRESH_BINARY)
        # Define a 15x15 kernel (the structure used to enlarge the mask)
        kernel = np.ones((15, 15), np.uint8)
        # DILATION: Expands the mask area to create a soft blending margin for inpainting
        dilated_mask = cv2.dilate(binary_mask, kernel, iterations=1)
        
        # Re-encode the dilated mask back to Base64 for API transmission
        _, buffer = cv2.imencode('.png', dilated_mask)
        refined_mask_b64 = base64.b64encode(buffer).decode('utf-8')
        refined_mask_data_url = f"{mask_header},{refined_mask_b64}"


        # 3. CALL LAMA INPAINTING SERVICE
        print(f"Starting Inpainting on {VM_LAMA_SERVER_URL}/inpaint")
        lama_response = requests.post(
            f"{VM_LAMA_SERVER_URL}/inpaint",
            json={
                # Send the original image and the newly dilated mask
                "image": f"data:image/png;base64,{original_image_base64}",
                "mask": refined_mask_data_url,
            },
            timeout=300 # Set a long timeout for the potentially slow inpainting process
        )

        # Handle LaMa API errors
        if lama_response.status_code != 200:
            return jsonify({
                'error': 'LaMa inpainting failed',
                'details': lama_response.text
            }), 500

        # Extract the Base64 inpainted image from the LaMa response
        inpainted_image_data = lama_response.json().get('inpainted_image')


        # 4. PREPARE INPUT AND CALL 3D GENERATION SERVICE
        # Calls a helper function (not shown) to prepare the input for 3D generation.
        # This function should use the *inpainted* image to ensure the 3D model is
        # generated in the *deleted* region (based on Hour 1's goal).
        final_image_base64_data_url = prepare_3d_input(image_url, mask_data)

        print(f"Starting 3D generation on {VM_3D_SERVER_URL}/process")
        infer_response = requests.post(
            f"{VM_3D_SERVER_URL}/process",
            json={"image": final_image_base64_data_url},
            timeout=300 # Set a long timeout for the 3D generation process
        )

        # Handle 3D generation API errors
        if infer_response.status_code != 200:
            return jsonify({
                'error': '3D generation failed',
                'details': infer_response.text
            }), 500

        # Extract the 3D model data (typically a PLY file)
        ply_data = infer_response.json().get('ply_data')
        
        if ply_data:
            try:
                # Define a directory to save your PLY files
                save_dir = 'generated_plys'
                os.makedirs(save_dir, exist_ok=True)
                
                # Create a unique filename
                filename = f"model_{int(time.time())}.ply"
                save_path = os.path.join(save_dir, filename)

                # Decode the Base64 data
                # Handle if it has a data URL prefix
                if 'base64,' in ply_data:
                    _, ply_b64_data = ply_data.split(',', 1)
                else:
                    ply_b64_data = ply_data # Assume it's raw Base64

                ply_bytes = base64.b64decode(ply_b64_data)
                
                # Write the bytes to a file
                with open(save_path, 'wb') as f:
                    f.write(ply_bytes)
                app.logger.info(f"Successfully saved 3D model to {save_path}")

            except Exception as save_e:
                # Log an error if saving fails, but don't stop the request
                app.logger.error(f"Failed to save PLY file: {save_e}")
        # 5. Synchronize and Return Both Results
        return jsonify({
            'status': 'success',
            'inpainted_image': inpainted_image_data,
            'ply_data': ply_data # Returns the 3D model data
        })

    except Exception as e:
        # Catch and log any unexpected server-side errors
        app.logger.error(f"Error in transform_to_3d_alive: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
   

# @app.route('/generate_3d_direct', methods=['POST'])
# def generate_3d_direct():
#     try:
#         data = request.json
#         image_url = data['image_url']
#         mask_data = data['mask_data']  # This is the actual mask data

#         # Extract filename from URL
#         image_filename = os.path.basename(image_url)
#         image_path = os.path.join('generated_images', image_filename)
        
#         # Verify image exists
#         if not os.path.exists(image_path):
#             return jsonify({'error': 'Image file not found'}), 404
        
#         # Load original image
#         with open(image_path, 'rb') as f:
#             original_image = Image.open(f).convert('RGBA')
        
#         # Decode mask (base64 string)
#         if ',' in mask_data:
#             mask_data = mask_data.split(',')[-1]
            
#         mask_bytes = base64.b64decode(mask_data)
#         mask_image = Image.open(BytesIO(mask_bytes)).convert('L')
        
#         # Ensure mask matches image size
#         if mask_image.size != original_image.size:
#             mask_image = mask_image.resize(original_image.size, Image.LANCZOS)
        
#         # Create isolated image with only the masked area
#         isolated_image = Image.new('RGBA', original_image.size, (0, 0, 0, 0))
#         isolated_image.paste(original_image, (0, 0), mask_image)
        
#         # Crop to bounding box of the non-transparent pixels
#         bbox = isolated_image.getbbox()
#         if not bbox:
#             return jsonify({'error': 'No object found in mask'}), 400
            
#         cropped = isolated_image.crop(bbox)
        
#         # Resize to 256x256 while maintaining aspect ratio
#         width, height = cropped.size
#         scale = min(256/width, 256/height)
#         new_width = int(width * scale)
#         new_height = int(height * scale)
        
#         resized = cropped.resize((new_width, new_height), Image.LANCZOS)
        
#         # Create 256x256 canvas with transparent background
#         final_image = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        
#         # Center the resized image
#         x = (256 - new_width) // 2
#         y = (256 - new_height) // 2
#         final_image.paste(resized, (x, y))
        

#         final_image.save('debuggg.png')
#         # Convert to base64
#         buffer = BytesIO()
#         final_image.save(buffer, format='PNG', optimize=True)
#         final_image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
        
#         # Send to 3D server
#         print(f"Sending cropped image to {VM_3D_SERVER_URL}/process")
        
#         response = requests.post(
#             f"{VM_3D_SERVER_URL}/process",  
#             json={"image": f"data:image/png;base64,{final_image_base64}"},
#             timeout=300
#         )
        
#         # Save the returned PLY data locally
#         if response.status_code == 200:
#             ply_data = response.json().get('ply_data')
#             if ply_data:
#                 os.makedirs('3d_models', exist_ok=True)
#                 filename = f"3d_model_{int(time.time())}.ply"
#                 filepath = os.path.join('3d_models', filename)
                
#                 with open(filepath, 'wb') as f:
#                     f.write(base64.b64decode(ply_data))

#         if response.status_code != 200:
#             return jsonify({
#                 'error': '3D generation failed',
#                 'details': response.text
#             }), 500
        
#         return jsonify(response.json())
        
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500
    
#SAM Endpoint
@app.route('/segment_with_sam', methods=['POST'])
def segment_with_sam():
    try:
        data = request.json
        image_path = os.path.join('generated_images', os.path.basename(data['image_url']))
        
        if not os.path.exists(image_path):
            return jsonify({'error': 'Image file not found'}), 404

        with open(image_path, 'rb') as img_file:
            image_bytes = img_file.read()
            image_base64 = base64.b64encode(image_bytes).decode('utf-8')

        response = requests.post(
            f"{SAMVMURL}/segment",
            json={
                'image_url': f"data:image/png;base64,{image_base64}",
                'input_points': data['input_points'],
                'input_labels': data['input_labels']
            },
            timeout=300
        )

        if response.status_code != 200:
            return jsonify({
                'error': 'SAM processing failed',
                'details': response.text
            }), 500

        return jsonify(response.json())

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    


@app.route('/gemini', methods=['POST'])
def gemini_iterate():
        data = request.json or {}
        prompt = data.get('prompt')
        image_filename = data.get('image_filename')
        model = data.get('model', "gemini-2.0-flash-001")


        try:
            result = call_gemini(prompt, image_filename, model)


            timestamp = int(time.time())
            safe_prompt = "".join(c for c in prompt if c.isalnum() or c in (' ', '_')).rstrip()
            safe_prompt = safe_prompt[:50].replace(" ", "_")
            new_filename = f"{safe_prompt}__{timestamp}_{uuid.uuid4().hex[:4]}.png"
            new_path = os.path.join("generated_images", new_filename)


            with open(new_path, 'wb') as f:
                f.write(result['image_bytes'])


            response_data = {
                'id': str(uuid.uuid4()),
                'filename': new_filename,
                'url': f"/generated_images/{new_filename}",
                'prompt': prompt,
                'description': result.get('text_response', ''),
                'timestamp': timestamp * 1000,
                'model': model
            }


            socketio.emit('new_image', response_data)
            return jsonify(response_data)


        except Exception as e:
            app.logger.error(f"Error in gemini_iterate: {e}", exc_info=True)
            return jsonify({'error': str(e)}), 500
        


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