import React, { useState } from "react";
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

  
  const generate3DModel = async () => {
    if (!segmentationData.maskData) {
      setError("No mask data available");
      return;
    }
    
    setShow3DViewer(false);
    setIsGenerating3D(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:5000/generate_3d_direct', {
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

      // Handle PLY data (your existing logic)
      if (result.ply_data) {
        const binaryString = window.atob(result.ply_data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        setThreeDModel(bytes.buffer.slice(0));
        setShow3DViewer(true);
      } else if (result.ply_url) {
        const plyResponse = await fetch(`http://localhost:5000${result.ply_url}`);
        if (!plyResponse.ok) {
          throw new Error(`Failed to fetch PLY file: ${plyResponse.status}`);
        }
        const plyBlob = await plyResponse.blob();
        const plyArrayBuffer = await plyBlob.arrayBuffer();
        setThreeDModel(plyArrayBuffer.slice(0));
        setShow3DViewer(true);
      } else {
        throw new Error('No PLY data or URL received from server');
      }
    } catch (error) {
      console.error("3D generation error:", error);
      setError(error.message || 'Unknown error during 3D generation');
    } finally {
      setIsGenerating3D(false);
    }
  };



  return (
    <div className="image-message">
  

      <div className="image-container">
        <img
          src={`http://localhost:5000${
            msg.content.startsWith("/") ? msg.content : `/${msg.content}`
          }`}
          alt={msg.prompt || "Generated image"}
          onClick={(e) => handleImageClick(e, msg.content)}
          onLoad={(e) => {
            const img = e.target;
            const rect = img.getBoundingClientRect();
            setSegmentationData((prev) => ({
              ...prev,
              displayWidth: rect.width,
              displayHeight: rect.height,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
            }));
          }}
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
      />
  
    )}

        <SegmentationOverlay
        msg={msg}
        segmentationData={segmentationData}
        error={error}
        loading={loading}
        show3DViewer={show3DViewer}
        />


        

        {/* 3D Generation Overlay */}
        {isGenerating3D && segmentationData.imageUrl === msg.content && (
          <div className="generating-3d-overlay">
            <div className="generating-3d-text">Generating 3D model...</div>
          </div>
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

      {/* Control Buttons */}
      {segmentationData.imageUrl === msg.content && (
      <SegmentationControls
          segmentationData={segmentationData}
          generate3DModel={generate3DModel}
          clearSegmentation={clearSegmentation}
          threeDModel={threeDModel}
          show3DViewer={show3DViewer}
          setShow3DViewer={setShow3DViewer}
          isGenerating3D={isGenerating3D}
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
