import React, { useState, useRef, useEffect } from "react";
import SegmentationControls from "./SegmentationControls";
import SegmentationOverlay from "./SegmentationOverlay";
import ThreeDViewer from "./3Dviewer"
import "./ImageMessage.css"
import html2canvas from "html2canvas";

const ImageMessage = ({
  msg,
  segmentationData,
  setSegmentationData,
  loading,
  error,
  handleImageClick,
  clearSegmentation,
  setError,
  onRerenderComplete
}) => {
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const [threeDModel, setThreeDModel] = useState(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [inpaintedImage, setInpaintedImage] = useState(null); 
  const [detailedPrompt, setDetailedPrompt] = useState(null);
  
  const [rerenderedImage, setRerenderedImage] = useState(null); 
  const [rerenderOptions, setRerenderOptions] = useState([]);   
  
  const [cachedBase64, setCachedBase64] = useState(null);
  const [cachedPrompt, setCachedPrompt] = useState(null);

  const imageContainerRef = useRef(null); 
  const threeDContainerRef = useRef(null);
  const [isRerendering, setIsRerendering] = useState(false);
  const [rerenderError, setRerenderError] = useState(null);

  const resetViewRef = useRef(null);

  useEffect(() => {
    if (!segmentationData.imageUrl || segmentationData.imageUrl !== msg.content) {
      setThreeDModel(null);
      setShow3DViewer(false);
      setInpaintedImage(null);
      setIsGenerating3D(false);
      setIsRerendering(false); 
      setRerenderError(null);
      setDetailedPrompt(null);
      setRerenderedImage(null); 
      setRerenderOptions([]);
      
      setCachedBase64(null);
      setCachedPrompt(null);
    }
  }, [segmentationData.imageUrl, msg.content]); 


  const generate3DModel = async () => {
    if (!segmentationData.maskData) {
      setError("No mask data available");
      return;
    }
    
    setShow3DViewer(false);
    setInpaintedImage(null);
    setIsGenerating3D(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:5000/transform_to_3d_alive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: segmentationData.imageUrl,
          mask_data: segmentationData.maskData,
          prompt: msg.prompt
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      if (result.inpainted_image) {
        setInpaintedImage(result.inpainted_image);
      } else {
        throw new Error('No inpainted image received from server');
      }

      if (result.detailed_prompt) {
        setDetailedPrompt(result.detailed_prompt);
        console.log("Detailed prompt received and stored:", result.detailed_prompt);
      }

      if (result.ply_data) {
        const binaryString = window.atob(result.ply_data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        setThreeDModel(bytes.buffer.slice(0));
        setShow3DViewer(true);
      } else {
        throw new Error('No PLY data received from server');
      }
    } catch (error) {
      console.error("3D generation error:", error);
      setError(error.message || 'Unknown error during 3D generation');
      setInpaintedImage(null);
    } finally {
      setIsGenerating3D(false);
    }
  };


  const handleRerender = async () => {
    setIsRerendering(true);
    setRerenderError(null);
    setRerenderOptions([]); 

    try {
      let imageBase64;
      let promptToSend;

      if (cachedBase64 && cachedPrompt) {
        console.log("Using cached image and prompt for rerender.");
        imageBase64 = cachedBase64;
        promptToSend = cachedPrompt;
      } else {
        console.log("Capturing new image and prompt for rerender.");
        if (!threeDContainerRef.current) {
          throw new Error("3D viewer container not found.");
        }
        
        const canvas = await html2canvas(threeDContainerRef.current, {
          useCORS: true, 
          allowTaint: true,
          backgroundColor: null, 
          preserveDrawingBuffer: true, 
        });
        
        imageBase64 = canvas.toDataURL('image/png');
        promptToSend = detailedPrompt || msg.prompt || "a new version of this";

        setCachedBase64(imageBase64);
        setCachedPrompt(promptToSend);
        
        setShow3DViewer(false); 
      }
      
      console.log("Sending this prompt to rerender:", promptToSend);
      
      const response = await fetch('http://localhost:5000/rerender_with_canny', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
          prompt: promptToSend
        }),
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      if (data.image_options && data.image_options.length > 0) {
        setRerenderOptions(data.image_options);
        setRerenderedImage(null); 
      } else {
        throw new Error("No image options received from server.");
      }
      
    } catch (err) {
      console.error("Rerender failed:", err);
      setRerenderError(err.message || "Failed to rerender.");
      setRerenderOptions([]); 
    } finally {
      setIsRerendering(false); 
    }
  };


  const handleOptionSelect = (selectedImageUrl) => {
    setRerenderedImage(selectedImageUrl); 
    setRerenderOptions([]); 
    
    if (onRerenderComplete) {
      onRerenderComplete(selectedImageUrl, msg.prompt); 
    }
  };


  const getCurrentImageSource = () => {
    if (inpaintedImage && (show3DViewer || rerenderedImage || rerenderOptions.length > 0)) {
      return inpaintedImage;
    }
    if (msg.content.startsWith('data:image')) {
      return msg.content; 
    }

    return `http://localhost:5000${
      msg.content.startsWith("/") ? msg.content : `/${msg.content}`
    }`;
  };

  const isClickable = !show3DViewer && !rerenderedImage && rerenderOptions.length === 0;

  return (
    <div className="image-message">
      <div className="image-container" ref={imageContainerRef}>
     <img
          src={getCurrentImageSource()}
          alt={msg.prompt || "Generated"} 
          crossOrigin="anonymous"
          onClick={isClickable ? (e) => handleImageClick(e, msg.content) : undefined}
          style={isClickable ? {} : { cursor: 'default' }}
          onLoad={!show3DViewer ? (e) => {
            const img = e.target;
            const rect = img.getBoundingClientRect();
            setSegmentationData((prev) => ({
              ...prev,
              displayWidth: rect.width,
              displayHeight: rect.height,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
            }));
          } : undefined}
        />
        
      {rerenderedImage && !show3DViewer && rerenderOptions.length === 0 && (
       <img
          src={rerenderedImage}
          alt="Refined result" 
          crossOrigin="anonymous"
          className="rerendered-image-overlay"
          style={segmentationData.bbox ? {
            position: 'absolute',
            left: `${segmentationData.bbox[0] * 100}%`,
            top: `${segmentationData.bbox[1] * 100}%`,
            width: `${(segmentationData.bbox[2] - segmentationData.bbox[0]) * 100}%`,
            height: `${(segmentationData.bbox[3] - segmentationData.bbox[1]) * 100}%`,
            objectFit: 'cover' 
          } : {}}
        />
      )}

      {/* 3D Viewer */}
      <div className="three-d-wrapper" ref={threeDContainerRef}style={{
          position: "absolute", 
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 10,
          borderRadius: "8px",
          overflow: "hidden",
          transform: "translateZ(0)",
          display: show3DViewer ? "block" : "none", 
        }}>
        {threeDModel && segmentationData.imageUrl && (
          <ThreeDViewer
            threeDModel={threeDModel}
            bboxs={segmentationData.bbox}
            imageDisplaySize={{
              width: segmentationData.displayWidth, 
              height: segmentationData.displayHeight,
              offsetX: segmentationData.offsetX,
              offsetY: segmentationData.offsetY,
            }}
            show3DViewer={show3DViewer}
            setShow3DViewer={setShow3DViewer}
            setError={setError}
            resetViewRef={resetViewRef}
          />
        )}
        </div>
          
        {segmentationData.imageUrl === msg.content && !show3DViewer && !rerenderedImage && rerenderOptions.length === 0 && (
            <SegmentationOverlay
              msg={msg}
              segmentationData={segmentationData}
              error={error}
              loading={loading}
              show3DViewer={show3DViewer}
            />
        )}
        
        {isGenerating3D && segmentationData.imageUrl === msg.content && (
          <div className="generating-3d-overlay">
            <div className="generating-3d-text">Generating 3D model...</div>
          </div>
        )}

        {isRerendering && rerenderOptions.length === 0 && (
          <div className="rerendering-overlay">
            <div className="rerendering-text">Refining image...</div>
          </div>
        )}

        {/* Image Selection*/}
        {rerenderOptions.length > 0 && (
          <div className="rerender-selection-overlay">
            <div className="rerender-selection-header">
              <p>Select your preferred image</p>
              <button
                className="reroll-btn"
                onClick={handleRerender}
                disabled={isRerendering} 
              >
                {isRerendering ? "..." : "Try Again"}
              </button>
            </div>
            <div className="rerender-options-container">
              {rerenderOptions.map((imgSrc, index) => (
                <img
                  key={index}
                  src={imgSrc}
                  alt={`Option ${index + 1}`}
                  className="rerender-option-image"
                  onClick={() => handleOptionSelect(imgSrc)}
                />
              ))}
            </div>
          </div>
        )}

      </div>

      {segmentationData.imageUrl === msg.content && !rerenderedImage && rerenderOptions.length === 0 && (
        <SegmentationControls
          segmentationData={segmentationData}
          generate3DModel={generate3DModel}
          clearSegmentation={clearSegmentation}
          threeDModel={threeDModel}
          show3DViewer={show3DViewer}
          setShow3DViewer={setShow3DViewer}
          isGenerating3D={isGenerating3D}
          resetViewRef={resetViewRef}
          onRender={handleRerender}
          isRerendering={isRerendering}
          rerenderError={rerenderError}
        />
      )}

      {msg.prompt && <div className="image-prompt">{msg.prompt}</div>}
      {msg.timestamp && (
        <div className="image-timestamp">
          {new Date(msg.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default ImageMessage;