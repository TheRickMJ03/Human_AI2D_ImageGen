import React, { useState, useEffect, useRef } from 'react';
import './ChatHistory.css';

const ChatHistory = ({ messages }) => {
  const chatEndRef = useRef(null);
  const [segmentationData, setSegmentationData] = useState({
    imageUrl: null,
    points: [],
    mask: null
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

const handleImageClick = async (e, imageUrl) => {
  const img = e.target;
  const rect = img.getBoundingClientRect();
  
  // Calculate coordinates relative to the displayed image
  const displayWidth = rect.width;
  const displayHeight = rect.height;
  
  // Get natural image dimensions
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  
  // Calculate scale factors
  const scaleX = naturalWidth / displayWidth;
  const scaleY = naturalHeight / displayHeight;
  
  // Get click position in image coordinates
  const clickX = (e.clientX - rect.left) * scaleX;
  const clickY = (e.clientY - rect.top) * scaleY;
  
  // Normalize coordinates (0-1 range)
  const normalizedX = clickX / naturalWidth;
  const normalizedY = clickY / naturalHeight;

  console.log('Click coordinates:', {
    display: { x: e.clientX - rect.left, y: e.clientY - rect.top },
    image: { x: clickX, y: clickY },
    normalized: { x: normalizedX, y: normalizedY }
  });

  const newPoints = segmentationData.imageUrl === imageUrl
    ? [...segmentationData.points, { x: normalizedX, y: normalizedY }]
    : [{ x: normalizedX, y: normalizedY }];

  setSegmentationData(prev => ({
    ...prev,
    imageUrl,
    points: newPoints,
    mask: null
  }));

  try {
    setLoading(true);
    setError(null);

    const response = await fetch('http://localhost:5000/segment_with_sam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: `http://localhost:5000${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`,
        input_points: newPoints.map(p => [p.x, p.y]),
        input_labels: Array(newPoints.length).fill(1)
      })
    });

      const data = await response.json();
         // Check if masks array exists and has at least one element
      if (!data.masks || data.masks.length === 0) {
        throw new Error('No masks received in response');
      }

    

      // Select the mask with highest confidence score
      const bestMask = data.masks.reduce((prev, current) => 
        (prev.score > current.score) ? prev : current
      );

       if (!bestMask.mask) {
      throw new Error('No mask data in best mask');
      }

      setSegmentationData(prev => ({
        ...prev,
        mask: `data:image/png;base64,${bestMask.mask}`
      }));


    } catch (error) {
      console.error("Segmentation Error:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const clearSegmentation = () => {
    setSegmentationData({
      imageUrl: null,
      points: [],
      mask: null
    });
  };

  return (
    <div className="chat-history">
      {[...messages].reverse().map((msg, index) => (
        <div key={`${index}-${msg.timestamp}`} className={`bubble ${msg.role}`}>
          {msg.type === 'text' ? (
            <p>{msg.content}</p>
          ) : (
            <div className="image-message">
              {loading && segmentationData.imageUrl === msg.content && (
                <div className="segmentation-loading">Processing segmentation...</div>
              )}
              {error && segmentationData.imageUrl === msg.content && (
                <div className="segmentation-error">{error}</div>
              )}
              
              <div className="image-container">
                <img 
                  src={`http://localhost:5000${msg.content.startsWith('/') ? msg.content : `/${msg.content}`}`} 
                  alt={msg.prompt || 'Generated image'}
                  onClick={(e) => handleImageClick(e, msg.content)}
                  className={segmentationData.imageUrl === msg.content ? 'segmenting' : ''}
                  onError={(e) => {
                    e.target.onerror = null; 
                    e.target.src = 'fallback-image-url.jpg';
                  }}
                />
                
                {/* Segmentation Mask Container */}
                {segmentationData.mask && (
                  <img
                    src={segmentationData.mask}
                    alt="Segmentation result"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      pointerEvents: 'none',
                      opacity: 0.7
                    }}
                  />
                )}
                
                {/* Segmentation Points */}
                {segmentationData.imageUrl === msg.content && (
                  segmentationData.points.map((point, i) => (
                    <div
                      key={i}
                      className="segmentation-point"
                      style={{
                        left: `${point.x * 100}%`,
                        top: `${point.y * 100}%`,
                      }}
                    />
                  ))
                )}
                
                {/* Clear Button */}
                {segmentationData.imageUrl === msg.content && (
                  <button 
                    className="clear-segmentation" 
                    onClick={clearSegmentation}
                    title="Clear segmentation"
                  >
                    ×
                  </button>
                )}
              </div>
              
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
      
      <div ref={chatEndRef} />
    </div>
  );
};

export default ChatHistory;