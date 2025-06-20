import os 
import time
import uuid #unique ids for images 
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS 
from dotenv import load_dotenv
from huggingface_hub import InferenceClient 
from flask_socketio import SocketIO, emit 

load_dotenv()

app = Flask(__name__)
CORS(app) 
socketio = SocketIO(app, cors_allowed_origins="*")  

# Configuration
HF_TOKEN = os.getenv("HF_API_TOKEN") 
MODEL_NAME = "black-forest-labs/FLUX.1-schnell"
INFERENCE_PROVIDER = "together"

# Initialize client
client = InferenceClient(
    provider=INFERENCE_PROVIDER,
    api_key=HF_TOKEN,
)


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



@app.route('/generate', methods=['POST'])
def generate_image():
    if not request.is_json:
        return jsonify({'error': 'Request must be JSON'}), 400
        
    prompt = request.json.get('prompt')
    
    if not prompt:
        return jsonify({'error': 'Prompt required'}), 400
    
    try:
        # Generate image
        image = generate_image_with_client(prompt)
        
        # Save with metadata
        timestamp = int(time.time())
        safe_prompt = prompt.replace(" ", "_")[:100]
        filename = f"{safe_prompt}__{timestamp}_{uuid.uuid4().hex[:4]}.png"
        image_path = f"generated_images/{filename}"
        image.save(image_path)
        
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