import React from "react";
import './SegmentationOverlay.css';

const SegmentationOverlay = ({
  msg,
  segmentationData,
  error,
  loading,
  show3DViewer
}) => {
  return (
    <>
      {/* Loading */}
      {loading && segmentationData.imageUrl === msg.content && (
        <div className="segmentation-loading">Processing segmentation...</div>
      )}

      {/* Error */}
      {error && segmentationData.imageUrl === msg.content && (
        <div className="segmentation-error">{error}</div>
      )}

      {/* Segmentation Mask */}
      {segmentationData.mask && !show3DViewer && (
        <img
          src={segmentationData.mask}
          alt="Segmentation result"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            opacity: 0.7,
          }}
        />
      )}

      {/* Segmentation Points */}
      {segmentationData.imageUrl === msg.content &&
        !show3DViewer &&
        segmentationData.points.map((point, i) => (
          <div
            key={i}
            className="segmentation-point"
            style={{
              left: `${point.x * 100}%`,
              top: `${point.y * 100}%`,
            }}
          />
        ))}
    </>
  );
};

export default SegmentationOverlay;
