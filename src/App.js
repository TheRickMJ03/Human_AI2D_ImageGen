import React, { useState, useEffect } from 'react';
import ImageGenerator from './components/ImageGen_Input/ImageGen_Input';
import ImageGen from './components/ImageGen/ImageGen';
import Thumbnails from './components/Thumbnails/Thumbnails';
import { io } from "socket.io-client";
import './Animation.css';
import './App.css';

function App() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const [showTitle, setShowTitle] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);

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
    
    setTimeout(() => {
      setIsGenerating(true);
      setIsAnimating(true);
      setCurrentImage(null);
      
      fetch('http://localhost:5000/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      .then(response => {
        if (!response.ok) throw new Error('Generation failed');
      })
      .catch(error => {
        console.error(error);
        setIsGenerating(false);
        setIsAnimating(false);
      });
    }, 500); 
  };

  return (
    <div className="app">
      {showTitle && (
        <div className="title-container fade-in">
          <h1 className="main-title">Human_AI2D_ImageGen</h1>
          <p className="subtitle">By Ricardo Mejia </p>
        </div>
      )}
      
      <div className={`content-container ${!showTitle ? 'content-expand' : ''}`}>
        {/* Animated ImageGen - only shown after title disappears */}
        {!showTitle && (
          <div className={isAnimating ? "image-gen-animate" : ""}>
            <ImageGen isGenerating={isGenerating} currentImage={currentImage} />
          </div>
        )}

        {/* Input with push-down effect */}
        <div className={isAnimating ? "input-tape-animate" : ""}>
          <ImageGenerator onGenerate={handleGenerate} />
        </div>

        <Thumbnails images={images} loading={loading} isGallery={false} />
      </div>
    </div>
  );
}

export default App;