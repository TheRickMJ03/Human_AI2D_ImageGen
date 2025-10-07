import React from "react";
import './SegmentationControls.css';

const SegmentationControls = ({
  segmentationData,
  generate3DModel,
  clearSegmentation,
  threeDModel,
  show3DViewer,
  setShow3DViewer,
  isGenerating3D,
  resetViewRef
}) => {
  return (
    <div className="segmentation-controls">
      <div className="points-count">
        Points: {segmentationData.points.length}
      </div>
      
      <button
        className="generate-3d-btn"
        onClick={generate3DModel}
        disabled={isGenerating3D || !segmentationData.mask}
      >
        {isGenerating3D ? "Generating 3D..." : "Generate 3D"}
      </button>

      {threeDModel && (
        <button
          className="toggle-3d-btn"
          onClick={() => setShow3DViewer(!show3DViewer)}
        >
          {show3DViewer ? "Hide 3D" : "Show 3D"}
        </button>
      )}

      {show3DViewer && (
        <button
          className="reset-view-btn"
          onClick={() => resetViewRef.current && resetViewRef.current()}
        >
          Reset View
        </button>
      )}

      <button
        className="clear-segmentation-btn"
        onClick={clearSegmentation}
      >
        Clear
      </button>
    </div>
  );
};

export default SegmentationControls;