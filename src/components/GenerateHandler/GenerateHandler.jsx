import { OpenAI  } from 'openai';
const HF_MODELS = {
  'black-forest-labs/FLUX.1-schnell': {
    name: 'FLUX.1-schnell',
    provider: 'together'
  },
  'stabilityai/stable-diffusion-xl-base-1.0': {
    name: 'SDXL',
    provider: 'nebius' 
  },

  }; 
export const handleGeneration = async ({
  prompt,
  selectedModel,
  conversation,
  setShowTitle,
  setIsGenerating,
  setIsAnimating,
  setCurrentImage,
  setImages,
  setConversation
}) => {
  setShowTitle(false);
  setIsGenerating(true);
  setIsAnimating(true);
  setCurrentImage(null);

  try {
    let result;
    let imageFilename = null;
        // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.REACT_APP_OPENAI_API_KEY,
      dangerouslyAllowBrowser: true
    });
    // Always use the last image from conversation history
    if (conversation.length > 0) {
      const lastImage = conversation[conversation.length - 1];
      const urlParts = lastImage.url.split('/');
      imageFilename = urlParts[urlParts.length - 1];
      console.log('Using last generated image:', imageFilename);
    }

    switch (selectedModel.provider) {


     case 'openai':
                try {
            let openaiResponse;
            
            
            if (selectedModel.model === 'gpt-4-vision-preview') {
              openaiResponse = await openai.chat.completions.create({
                model: selectedModel.model,
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: prompt },
                      { 
                        type: "image_url",
                        image_url: result?.url  
                      }
                    ]
                  }
                ],
                max_tokens: 300
              });
              
              result = {
                response: openaiResponse.choices[0].message.content,
                provider: 'openai',
                model: selectedModel.model,
                prompt: prompt,
                timestamp: Date.now()
              };
            } 
            else {
              openaiResponse = await openai.images.generate({
                model: selectedModel.model,
                prompt: prompt,
                n: 1,
                size: "1024x1024",
              });

              result = {
                url: openaiResponse.data[0].url,
                provider: 'openai',
                model: selectedModel.model,
                prompt: prompt,
                timestamp: Date.now()
              };

              const saveResponse = await fetch('http://localhost:5000/save_openai_image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  image_url: result.url,
                  prompt: prompt,
                  model: selectedModel.model
                })
              });

              if (!saveResponse.ok) throw new Error('Failed to save image to backend');
            }

            return result;
            
          } catch (error) {
            console.error("OpenAI API error:", error);
            throw new Error(`OpenAI processing failed: ${error.message}`);
          }

    case 'Imagen':
      if (selectedModel.model === 'gemini-2.0-flash-preview-image-generation') {
          const response = await fetch('http://localhost:5000/gemini', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  prompt: prompt,
                  image_filename: conversation.length > 0 ? imageFilename : null,
                  model: selectedModel.model
              }),
          });
          
          if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Gemini generation failed');
          }
          
          result = await response.json();
          return result; // Let the socket handle UI updates
      }else{
        const imagenResponse = await fetch('http://localhost:5000/imagen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              prompt, 
              model: selectedModel.model,
              size: "1024x1024" 
            })
          });

          if (!imagenResponse.ok) {
            const errorData = await imagenResponse.json();
            throw new Error(errorData.error || 'Imagen generation failed');
          }

        
          result = await imagenResponse.json();
          return result; // Let the socket handle UI updates


      }
      break;




    case 'huggingface':
      const hfModel = HF_MODELS[selectedModel.model];
      if (!hfModel) {
        throw new Error(`No configuration found for model: ${selectedModel.model}`);
      }
      const hfresponse = await fetch('http://localhost:5000/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt,
          model: selectedModel.model,
          provider: hfModel.provider 
        })
      });
      
      if (!hfresponse.ok) throw new Error('HuggingFace generation failed');
      result = await hfresponse.json();
      break;

    }
      setImages(prev => [{
            id: result.id,
            url: result.url,
            prompt: result.prompt,
            timestamp: result.timestamp,
            model: result.model
          }, ...prev]);

          setCurrentImage({
            id: result.id,
            url: result.url,
            prompt: result.prompt,
            timestamp: result.timestamp,
            model: result.model
          });

          } catch (error) {
              console.error("Generation failed:", error);
              alert(`Error: ${error.message}`);
            } finally {
              setIsGenerating(false);
            }
};