import React, { useState, useEffect, useRef } from 'react';
import { CSSTransition } from 'react-transition-group';
import { OpenAI } from 'openai';
import { io } from "socket.io-client";

// Components
import ImageGenerator from './components/ImageGen_Input/ImageGen_Input';
import Thumbnails from './components/Thumbnails/Thumbnails';

// Assets
import ImagenLogo from './assets/gemini_logo.png';
import openailogo from './assets/chatgpt-logo-chat-gpt-icon-on-white-background-free-vector.jpg';
import Hflogo from './assets/hf-logo.svg';
import { ReactComponent as CaretIcon } from './assets/download.svg';
import { ReactComponent as ArrowIcon } from './assets/arrow.svg';
import { ReactComponent as Right_arrow } from './assets/right_arrow.svg';

// Styles
import './Animation.css';
import './App.css';

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

function App() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const [showTitle, setShowTitle] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const [conversation, setConversation] = useState([]); //This will Track the whole conversation
  const [selectedModel, setSelectedModel] = useState({
    provider: 'openai',
    model: 'dall-e-3'
  });

  

  // Initialize API clients
  const openai = new OpenAI({
    apiKey: process.env.REACT_APP_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true
  });



  useEffect(() => {
  let isMounted = true;
  const newSocket = io('http://localhost:5000');

  const loadImages = async () => {
    if (!isMounted) return;
    setLoading(true);
    try {
      const res = await fetch('http://localhost:5000/Thumbnails');
      const data = await res.json();
      if (isMounted) setImages(data);
    } finally {
      if (isMounted) setLoading(false);
    }
  };
  
  loadImages();
  
 newSocket.on('new_image', (newImage) => {
  console.log('Received new image', newImage);
  
  setImages(prev => {
    const updatedImages = [newImage, ...prev];
    setConversation(prevConv => [
      ...prevConv.filter(item => item.id !== newImage.id),
      {
        prompt: newImage.prompt,
        url: newImage.url,
        description: newImage.description,
        id: newImage.id,
        model: newImage.model,
        timestamp: newImage.timestamp
      }
    ]);
    return updatedImages;
  });
  
  setCurrentImage(newImage);
  setIsGenerating(false);
});
  return () => {
    isMounted = false;
    newSocket.off('new_image');
    newSocket.disconnect();
  };
}, []);


const handleGenerate = async (prompt) => {
  setShowTitle(false);
  setIsGenerating(true);
  setIsAnimating(true);
  setCurrentImage(null);

  try {
    let result;
    let imageFilename = null;

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

 

  const handleModelSelect = (provider, model) => {
    setSelectedModel({ provider, model });
  };

return (
  <>
    <Navbar selectedModel={selectedModel}>
      <NavItem icon={<CaretIcon />}>
        <DropdownMenu 
          onModelSelect={handleModelSelect} 
          selectedModel={selectedModel}
        />
      </NavItem>
    </Navbar>

    {/* Scrollable content */}
          <div className="chat-wrapper">
        <div className="scrollable-chat">
          {showTitle && (
            <CSSTransition in={showTitle} timeout={300} classNames="fade" unmountOnExit>
              <div className="title-container">
                <h1 className="main-title">Human_AI2D_ImageGen</h1>
                <p className="subtitle">By Ricardo Mejia</p>
              </div>
            </CSSTransition>
          )}

          <div className={`content-container ${!showTitle ? 'content-expand' : ''}`}>
            <ImageGenerator 
              onGenerate={handleGenerate}
              selectedModel={selectedModel} 
              currentImage={currentImage}
              currentDescription={conversation.find(item => item.url === currentImage?.url)?.description}
              isGenerating={isGenerating}
            />
          </div>
        </div>

        {}
        <div className="fixed-thumbnails">
          <Thumbnails 
            images={[...new Map(images.map(item => [item.id, item])).values()]} 
            loading={loading} 
            isGallery={false}
            descriptions={conversation.reduce((acc, item) => {
              if (item.url && item.description) {
                acc[item.url] = item.description;
              }
              return acc;
            }, {})}
          />       
        </div>
      </div>
  </>
);

}

function Navbar(props) {
  return (
    <nav className="navbar">
      <ul className="navbar-nav">
        {props.children}
        <li className="nav-item model-indicator">
          <div className="model-text">
            {props.selectedModel.provider === 'openai' && (
              <>
                <img src={openailogo} alt="OpenAI" className="icon-image small" />
                   {props.selectedModel.model === 'dall-e-3' ? 'DALL·E 3' : 
                    props.selectedModel.model === 'dall-e-2' ? 'DALL·E 2' :
                    props.selectedModel.model === 'gpt-image-1' ? 'GPT IMAGE 1' : 
                    props.selectedModel.model 
    }
              </>
            )}
            {props.selectedModel.provider === 'Imagen' && (
              <>
                <img src={ImagenLogo} alt="Imagen" className="icon-image small" />
            {props.selectedModel.model.includes('gemini-2.0-flash') ? 'Gemini 2.0 Flash' :
            props.selectedModel.model.includes('imagen-4.0-ultra') ? 'Imagen 4 Ultra' :
            props.selectedModel.model.includes('imagen-4.0') ? 'Imagen 4' :
            'Imagen 3'}
                 
              </>
            )}
            {props.selectedModel.provider === 'huggingface' && (
              <>
                <img src={Hflogo} alt="HuggingFace" className="icon-image small" />
                {HF_MODELS[props.selectedModel.model]?.name || props.selectedModel.model}
                <span className="provider-tag">
                  {HF_MODELS[props.selectedModel.model]?.provider}
                </span>
              </>
            )}
          </div>
        </li>
      </ul>
    </nav>
  );
}

function NavItem(props) {
  const [open, setOpen] = useState(false);

  return (
    <li className="nav-item">
      <a href="#" className="icon-button" onClick={() => setOpen(!open)}>
        {props.icon}
      </a>
      {open && React.cloneElement(props.children, {
        closeMenu: () => setOpen(false)
      })}
    </li>
  );
}

function DropdownMenu({ onModelSelect, selectedModel, closeMenu  }) {
  const [activeMenu, setActiveMenu] = useState('main');
  const [menuHeight, setMenuHeight] = useState(null);
  const dropdownRef = useRef(null);
  const menuPrimaryRef = useRef(null);
  const menuImagenRef = useRef(null);
  const menuHuggingFaceRef = useRef(null);
  const menuOpenAIRef = useRef(null);

  useEffect(() => {
    setMenuHeight(dropdownRef.current?.firstChild.offsetHeight);
  }, []);

  function calcHeight(el) {
    const height = el.offsetHeight;
    setMenuHeight(height);
  }

  function DropdownItem(props) {
    return (
      <a 
        href="#" 
        className="menu-item" 
        onClick={() => {
          if (props.onClick) props.onClick();
          if (props.goToMenu) setActiveMenu(props.goToMenu);
        }}
      >
        <span className="icon-button">{props.leftIcon}</span>
        {props.children}
        <span className="icon-right">{props.rightIcon}</span>
      </a>
    );
  }

   const handleModelClick = (provider, model) => {
    onModelSelect(provider, model);
    closeMenu(); 
  };

  return (
    <div className="dropdown" style={{ height: menuHeight }} ref={dropdownRef}>
      <CSSTransition
        in={activeMenu === 'main'}
        timeout={500}
        classNames="menu-primary"
        unmountOnExit
        onEnter={calcHeight}
        nodeRef={menuPrimaryRef}
      >
        <div className="menu" ref={menuPrimaryRef}>
          <DropdownItem
            leftIcon={<img src={openailogo} alt="OpenAI" className="icon-image" />}
            rightIcon={<Right_arrow />}
            goToMenu="OpenAI"
          >
            OpenAI
          </DropdownItem>

          <DropdownItem
            leftIcon={<img src={ImagenLogo} alt="Imagen" className="icon-image" />}
            rightIcon={<Right_arrow />}
            goToMenu="Google Imagen"
          >
            Google Models
          </DropdownItem>

          <DropdownItem
            leftIcon={<img src={Hflogo} alt="HuggingFace" className="icon-image" />}
            rightIcon={<Right_arrow />}
            goToMenu="HuggingFace"
          >
            HuggingFace
          </DropdownItem>
        </div>
      </CSSTransition>

      <CSSTransition
        in={activeMenu === 'Google Imagen'}
        timeout={500}
        classNames="menu-secondary"
        unmountOnExit
        onEnter={calcHeight}
        nodeRef={menuImagenRef}
      >
        <div className="menu" ref={menuImagenRef}>
          <DropdownItem goToMenu="main" leftIcon={<ArrowIcon />}>
            <h2>Google Models</h2>
          </DropdownItem>
          <DropdownItem 
            leftIcon={<img src={ImagenLogo} alt="Imagen" className="icon-image" />}
            onClick={() => handleModelClick('Imagen', 'gemini-2.0-flash-preview-image-generation')}
            active={selectedModel.model === 'gemini-2.0-flash-preview-image-generation'}
          >
            Gemini-2.0-flash
          </DropdownItem>

          <DropdownItem 
            leftIcon={<img src={ImagenLogo} alt="Imagen" className="icon-image" />}
            onClick={() => handleModelClick('Imagen', 'imagen-4.0-ultra-generate-preview-06-06')}
            active={selectedModel.model === 'imagen-4.0-ultra-generate-preview-06-06'}
          >
            Imagen 4 Ultra
          </DropdownItem>
          <DropdownItem 
            leftIcon={<img src={ImagenLogo} alt="Imagen" className="icon-image" />}
            onClick={() => handleModelClick('Imagen', 'imagen-4.0-generate-preview-06-06')}
            active={selectedModel.model === 'imagen-4.0-generate-preview-06-06'}
          >
            Imagen 4 
          </DropdownItem>
          <DropdownItem 
            leftIcon={<img src={ImagenLogo} alt="Imagen" className="icon-image" />}
            onClick={() => handleModelClick('Imagen', 'imagen-3.0-generate-002')}
            active={selectedModel.model === 'imagen-3.0-generate-002'}
          >
            Imagen 3
          </DropdownItem>
        </div>
      </CSSTransition>

      <CSSTransition
        in={activeMenu === 'HuggingFace'}
        timeout={500}
        classNames="menu-secondary"
        unmountOnExit
        onEnter={calcHeight}
        nodeRef={menuHuggingFaceRef}
      >
        <div className="menu" ref={menuHuggingFaceRef}>
          <DropdownItem goToMenu="main" leftIcon={<ArrowIcon />}>
            <h2>HuggingFace Models</h2>
          </DropdownItem>
          
          {Object.entries(HF_MODELS).map(([modelId, modelData]) => (
            <DropdownItem 
              key={modelId}
              leftIcon={<img src={Hflogo} alt="HF" className="icon-image" />}
              onClick={() =>{ onModelSelect('huggingface', modelId)



                closeMenu();
              }}
              active={selectedModel.model === modelId}
            >
              {modelData.name}
              <span className="provider-tag">{modelData.provider}</span>
            </DropdownItem>
          ))}
        </div>
      </CSSTransition>

      <CSSTransition
        in={activeMenu === 'OpenAI'}
        timeout={500}
        classNames="menu-secondary"
        unmountOnExit
        onEnter={calcHeight}
        nodeRef={menuOpenAIRef}
      >
        <div className="menu" ref={menuOpenAIRef}>
          <DropdownItem goToMenu="main" leftIcon={<ArrowIcon />}>
            <h2>OpenAI</h2>
          </DropdownItem>
          <DropdownItem 
            leftIcon={<img src={openailogo} alt="OpenAI" className="icon-image" />}
            onClick={() => handleModelClick('openai', 'gpt-image-1')}
            active={selectedModel.model === 'gpt-image-1'}
          >
            GPT IMAGE 1
          </DropdownItem>

          <DropdownItem 
            leftIcon={<img src={openailogo} alt="OpenAI" className="icon-image" />}
            onClick={() => handleModelClick('openai', 'dall-e-3')}
            active={selectedModel.model === 'dall-e-3'}
          >
            DALL·E 3
          </DropdownItem>
          <DropdownItem 
            leftIcon={<img src={openailogo} alt="OpenAI" className="icon-image" />}
            onClick={() => handleModelClick('openai', 'dall-e-2')}
            active={selectedModel.model === 'dall-e-2'}
          >
            DALL·E 2
          </DropdownItem>
        </div>
      </CSSTransition>

    </div>
  );
}

export default App;