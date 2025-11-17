import React, { useState, useEffect, useRef } from 'react';
import './ChatHistory.css';
import TextMessage from "./TextMessage";
import ImageMessage from "./ImageMessage";

const ChatHistory = ({ messages,onRerenderComplete}) => {
  const chatEndRef = useRef(null);
  const [segmentationData, setSegmentationData] = useState({
    imageUrl: null,
    points: [],
    mask: null,
     maskData: null,  
    bbox:null
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);


  


  useEffect(() => {
  if (messages.length === 0) {
    setSegmentationData({
      imageUrl: null,
      points: [],
      mask: null,
      maskData: null,
      bbox: null
    });
    
  }
}, [messages.length]); 


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
      displayWidth,  
      displayHeight,
      naturalWidth,  
      naturalHeight,
      points: newPoints,
      mask: null,
      bbox:null
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
        mask: visUrl,
        maskData: bestMask.mask,

        bbox: bestMask.bbox
      }));

    } catch (error) {
      console.error("Error:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const clearSegmentation = () => {
    setSegmentationData({
      imageUrl: null,
      points: [],
      mask: null,
      bbox:null
    });
    setError(null);
  };


  return (
    <div className="chat-history">
      {[...messages].reverse().map((msg, index) => (
        <div key={`${index}-${msg.timestamp}`} className={`bubble ${msg.role}`}>
          {msg.type === 'text' ? (
            <TextMessage content={msg.content} />

          ) : (
          <ImageMessage
            msg={msg}
            segmentationData={segmentationData}
            setSegmentationData={setSegmentationData}
            loading={loading}
            error={error}
            onRerenderComplete={onRerenderComplete}
            handleImageClick={handleImageClick}
            clearSegmentation={clearSegmentation}
            setError={setError}
          />
          )}
        </div>
      ))}
      
      <div ref={chatEndRef} />
    </div>
  );
};

export default ChatHistory;