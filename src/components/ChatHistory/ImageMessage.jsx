import React, { useState, useRef, useEffect } from "react";
import SegmentationControls from "./SegmentationControls";
import SegmentationOverlay from "./SegmentationOverlay";
import ThreeDViewer from "./3Dviewer"
import "./ImageMessage.css"

const ImageMessage = ({
  msg,
  segmentationData,
  setSegmentationData,
  loading,
  error,
  handleImageClick,
  clearSegmentation,
  setError
}) => {
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const [threeDModel, setThreeDModel] = useState(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [inpaintedImage, setInpaintedImage] = useState(null); 
  
  const resetViewRef = useRef(null);

  useEffect(() => {
    if (!segmentationData.imageUrl || segmentationData.imageUrl !== msg.content) {
      setThreeDModel(null);
      setShow3DViewer(false);
      setInpaintedImage(null);
      setIsGenerating3D(false);
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
          mask_data: segmentationData.maskData
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

  const getCurrentImageSource = () => {
    if (inpaintedImage && show3DViewer) {
      return inpaintedImage;
    }
    return `http://localhost:5000${
      msg.content.startsWith("/") ? msg.content : `/${msg.content}`
    }`;
  };

  return (
    <div className="image-message">
      <div className="image-container">
        <img
          src={getCurrentImageSource()}
          alt={msg.prompt || "Generated image"}
          onClick={!show3DViewer ? (e) => handleImageClick(e, msg.content) : undefined}
          style={show3DViewer ? { cursor: 'default' } : {}}
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

          {segmentationData.imageUrl === msg.content && !show3DViewer && (
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

        {segmentationData.imageUrl === msg.content && !show3DViewer && (
          <button
            className="clear-segmentation"
            onClick={clearSegmentation}
            title="Clear segmentation"
          >
            ×
          </button>
        )}
      </div>

      {segmentationData.imageUrl === msg.content && (
        <SegmentationControls
          segmentationData={segmentationData}
          generate3DModel={generate3DModel}
          clearSegmentation={clearSegmentation}
          threeDModel={threeDModel}
          show3DViewer={show3DViewer}
          setShow3DViewer={setShow3DViewer}
          isGenerating3D={isGenerating3D}
          resetViewRef={resetViewRef}
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