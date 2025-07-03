import React, { useState, useCallback } from 'react';
import { InputCase } from '../Input/MessageSoftGPT';
import ImageGen from '../ImageGen/ImageGen';

const ImageGenerator = ({ onGenerate }) => {
  const [prompt, setPrompt] = useState('');
  const [submittedPrompt, setSubmittedPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const debouncedGenerate = useCallback(async (prompt) => {
    if (!prompt.trim()) return;
    
    setSubmittedPrompt(prompt);
    
    try {
      await onGenerate(prompt);
    } finally {
    }
  }, [onGenerate]);

  const handleSubmit = (e) => {
    e.preventDefault();
    debouncedGenerate(prompt);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  return (
    <div className="image-generator-container">


      <div className="image-display-area">
        {submittedPrompt && (
          <ImageGen 
            prompt={submittedPrompt}
            isGenerating={isGenerating}
 
          />
        )}
      </div>

      <div className="input-area">
          <InputCase 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onSubmit={handleSubmit}
          />
    
      </div>
    </div>
  );
};

export default ImageGenerator;