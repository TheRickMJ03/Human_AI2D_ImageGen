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
  const [isGenerating3D, setIsGenerating3D] = useState(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleImageClick = async (e, imageUrl) => {
    const img = e.target;
    const rect = img.getBoundingClientRect();

    // Calculate coordinates relative to the displayed image
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    const scaleX = naturalWidth / displayWidth;
    const scaleY = naturalHeight / displayHeight;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const normalizedX = clickX / naturalWidth;
    const normalizedY = clickY / naturalHeight;

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
      if (data.error) {
        throw new Error(data.error);
      }
      
      if (!data.masks || data.masks.length === 0) {
        throw new Error('No masks received in response');
      }

      // Pick best mask
      const bestMask = data.masks.reduce((prev, current) =>
        (prev.score > current.score) ? prev : current
      );

      if (!bestMask.mask || !bestMask.visualization) {
        throw new Error('Missing mask or visualization in best mask');
      }

      // Use visualization for overlay display
      const visUrl = `data:image/png;base64,${bestMask.visualization}`;
      setSegmentationData(prev => ({
        ...prev,
        mask: visUrl
      }));

    } catch (error) {
      console.error("Error:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // NEW: Function to generate 3D model
  const generate3DModel = async () => {
    if (!segmentationData.mask) return;
    
    setIsGenerating3D(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:5000/generate_3d_direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: segmentationData.imageUrl,
          mask_data: segmentationData.mask.split(',')[1] // Extract base64 data
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }


    } catch (error) {
      console.error("3D generation error:", error);
      setError(error.message);
    } finally {
      setIsGenerating3D(false);
    }
  };



  const clearSegmentation = () => {
    setSegmentationData({
      imageUrl: null,
      points: [],
      mask: null
    });
    setError(null);
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
                
                {/* Segmentation Mask Container - UNCHANGED */}
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
                
                {/* Segmentation Points - UNCHANGED */}
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
                
                {/* NEW: Control Buttons */}
                {segmentationData.imageUrl === msg.content && (
                  <div className="segmentation-controls">
                    <div className="points-count">
                      Points: {segmentationData.points.length}
                    </div>
                    <button 
                      className="generate-3d-btn"
                      onClick={generate3DModel}
                      disabled={isGenerating3D || !segmentationData.mask}
                    >
                      {isGenerating3D ? 'Generating 3D...' : 'Generate 3D'}
                    </button>
                    <button 
                      className="clear-segmentation-btn"
                      onClick={clearSegmentation}
                    >
                      Clear
                    </button>
                  </div>
                )}
                
                {/* 3D Generation Overlay */}
                {isGenerating3D && segmentationData.imageUrl === msg.content && (
                  <div className="generating-3d-overlay">
                    <div className="generating-3d-text">Generating 3D model...</div>
                  </div>
                )}
                
           
                
                {/* Clear Button - UNCHANGED */}
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