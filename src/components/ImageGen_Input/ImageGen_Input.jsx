import React, { useState, useEffect, useRef } from 'react';
import { InputCase } from '../Input/MessageSoftGPT';
import ChatHistory from '../ChatHistory/Chathistory';
import './ImageGen_Input.css';

const ImageGenerator = ({ onGenerate, isGenerating, currentImage }) => {
const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState([]); 
  const chatHistoryRef = useRef(null);

      useEffect(() => {
    sessionStorage.removeItem('chatMessages');
    setMessages([]);
  }, []);

  useEffect(() => {
    if (currentImage) {
      const newImageMessage = {
        role: 'assistant',
        type: 'image',
        content: currentImage.url,
        prompt: currentImage.prompt, 
        timestamp: currentImage.timestamp,
      };
      setMessages(prev => [...prev, newImageMessage]);
    }
  }, [currentImage]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    const newUserMessage = {
      role: 'user',
      type: 'text',
      content: prompt,
    };
    setMessages(prev => [...prev, newUserMessage]);

    try {
      await onGenerate(prompt);
    } catch (err) {
      console.error('Image generation failed:', err);
      const errorMessage = {
        role: 'assistant',
        type: 'text',
        content: 'Failed to generate image. Please try again.',
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setPrompt('');
  };

   return (
    <div className="chat-container">
      <div className="chat-history-container" ref={chatHistoryRef}>
        <ChatHistory messages={messages} />
        {isGenerating && (
          <div className="generating-indicator">
            Generating image...
          </div>
        )}
      </div>
      <div className="input-area">
        <InputCase 
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit(e)}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
};


export default ImageGenerator;