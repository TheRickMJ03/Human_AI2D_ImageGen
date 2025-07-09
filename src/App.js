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
      setCurrentImage(newImage);
      setImages(prev => [newImage, ...prev]);
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

    switch (selectedModel.provider) {


     case 'openai':
        try {
          const openaiResponse = await openai.images.generate({
            model: selectedModel.model,
            prompt: prompt,
            n: 1,
            size: "1024x1024",
            response_format: "url" 
          });

          result = {
            url: openaiResponse.data[0].url,
            provider: 'openai',
            model: selectedModel.model,
            prompt: prompt,
            timestamp: Date.now()
          };

          // Save the image to backend
          const saveResponse = await fetch('http://localhost:5000/save_openai_image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: result.url,
              prompt: prompt,
              model: selectedModel.model
            })
          });

          if (!saveResponse.ok) {
            throw new Error('Failed to save OpenAI image to backend');
          }

          
        } catch (error) {
          console.error("OpenAI generation failed:", error);
          throw new Error(`OpenAI generation failed: ${error.message}`);
        }
        break;

      case 'Imagen':
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


  } catch (error) {
    console.error("Image generation failed:", error);
    alert(`Image generation failed: ${error.message}`);
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

     
    <div className="app">
      <div className="main-content"> {}
        {showTitle && (
          <CSSTransition
            in={showTitle}
            timeout={300}
            classNames="fade"
            unmountOnExit
          >
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
            isGenerating={isGenerating}
          />
          <Thumbnails images={images} loading={loading} isGallery={false} />
        </div>
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
                {props.selectedModel.model === 'dall-e-3' ? 'DALL·E 3' : 'DALL·E 2'}
              </>
            )}
            {props.selectedModel.provider === 'Imagen' && (
              <>
                <img src={ImagenLogo} alt="Imagen" className="icon-image small" />
                {props.selectedModel.model.includes('4.0-ultra') ? 'Imagen 4 Ultra' : 
                 props.selectedModel.model.includes('4.0') ? 'Imagen 4' : 'Imagen 3'}
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
            Google Imagen
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
            <h2>Google Imagen</h2>
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