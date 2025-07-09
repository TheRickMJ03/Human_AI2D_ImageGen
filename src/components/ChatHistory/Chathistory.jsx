import React, { useEffect, useRef } from 'react';
import './ChatHistory.css';

const ChatHistory = ({ messages }) => {
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-history">
      {}
      <div ref={chatEndRef} />
      
      {}
      {[...messages].reverse().map((msg, index) => (
        <div key={`${index}-${msg.timestamp}`} className={`bubble ${msg.role}`}>
          {msg.type === 'text' ? (
            <p>{msg.content}</p>
          ) : (
            <div className="image-message">
              <img 
                src={`http://localhost:5000${msg.content}`} 
                alt={msg.prompt || 'Generated image'}
                onError={(e) => {
                  e.target.onerror = null; 
                  e.target.src = 'fallback-image-url.jpg';
                }}
              />
              {msg.prompt && <div className="image-prompt">{msg.prompt}</div>}
              {msg.timestamp && (
                <div className="image-timestamp">
                  {new Date(msg.timestamp).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default ChatHistory;