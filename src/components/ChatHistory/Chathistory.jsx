import React, { useState, useEffect, useRef } from 'react';
import './ChatHistory.css';

const ChatHistory = ({ messages }) => {
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
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const [threeDModel, setThreeDModel] = useState(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [isLoadingLibraries, setIsLoadingLibraries] = useState(false);
  const isLoadingLibrariesRef = useRef(false); // Add this ref


  // Keep the ref in sync with state
  useEffect(() => {
    isLoadingLibrariesRef.current = isLoadingLibraries;
  }, [isLoadingLibraries]);


useEffect(() => {
  // Reset 3D state when messages become empty (new chat)
  if (messages.length === 0) {
    setThreeDModel(null);
    setShow3DViewer(false);
    setIsGenerating3D(false);
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



// Load Spark library dynamically
useEffect(() => {
  let renderer, scene, camera, animationId;

  // Only setup once when we have a 3D model
  if (threeDModel && !isLoadingLibrariesRef.current) {
    const loadAndRender = async () => {
      setIsLoadingLibraries(true);
      setError(null);

      try {
        const { SplatMesh } = await import('@sparkjsdev/spark');
        const THREE = await import('three');

        // WebGL check
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) throw new Error('WebGL not supported');

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(60, 400 / 400, 0.1, 1000);

        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true
        });
        renderer.setSize(400, 400);
        renderer.setClearColor(0x000000, 0);

        scene.add(new THREE.AmbientLight(0x404040));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);

        const blob = new Blob([threeDModel], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);

        try {
          const splatMesh = new SplatMesh({ url });
          
          // ✅ scale/center based on bbox (or fallback)
          const bbox = segmentationData.bbox || {
            minX: 0, minY: 0, maxX: 1, maxY: 1
          };
          const bboxWidth = bbox.maxX - bbox.minX;
          const bboxHeight = bbox.maxY - bbox.minY;
          const scaleFactor = Math.max(bboxWidth, bboxHeight) * 3;

          splatMesh.scale.set(scaleFactor, scaleFactor, scaleFactor);
          splatMesh.position.set(0, 0, -3);
          scene.add(splatMesh);
        } finally {
          URL.revokeObjectURL(url);
        }

        const container = document.getElementById('three-container');
        if (container) {
          container.innerHTML = '';
          container.appendChild(renderer.domElement);

          const animate = () => {
            animationId = requestAnimationFrame(animate);
            if (scene && scene.children.length > 0) {
              scene.children[0].rotation.y += 0.01;
            }
            renderer.render(scene, camera);
          };

          animate();
        }
      } catch (err) {
        console.error('Error loading 3D viewer:', err);
        setError(err.message || 'Failed to load 3D viewer');
        setShow3DViewer(false);
      } finally {
        setIsLoadingLibraries(false);
      }
    };

    loadAndRender();
  }

  return () => {
    // Only cleanup when component unmounts or model changes completely
    // if (!threeDModel) {
      if (animationId) cancelAnimationFrame(animationId);
      if (renderer) {
        try {
          renderer.dispose();
          renderer.forceContextLoss?.();
        } catch (e) {
          console.warn('Error disposing renderer:', e);
        }
      }
      const container = document.getElementById('three-container');
      if (container) container.innerHTML = '';
    }
  // };
}, [threeDModel, segmentationData.bbox]);



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
      displayWidth,    // Store displayed dimensions
      displayHeight,
      naturalWidth,    // Store natural dimensions
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
        maskData: bestMask.mask, // actual mask data for cropping

        bbox: bestMask.bbox
      }));

    } catch (error) {
      console.error("Error:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const generate3DModel = async () => {
    
    if (!segmentationData.mask) return;
    // setThreeDModel(null);
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


    // Check if we received PLY data directly or need to fetch it
    if (result.ply_data) {
      // Convert base64 PLY data to ArrayBuffer
      const binaryString = window.atob(result.ply_data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      setThreeDModel(bytes.buffer.slice(0));
      setShow3DViewer(true);
       
      
      // const container = document.getElementById('three-container');
      //   if (container) {
      //     container.innerHTML = '';
      //   }


    } else if (result.ply_url) {
      // If server returns a URL to the PLY file, fetch it
      const plyResponse = await fetch(`http://localhost:5000${result.ply_url}`);
      if (!plyResponse.ok) {
        throw new Error(`Failed to fetch PLY file: ${plyResponse.status}`);
      }
      
      const plyBlob = await plyResponse.blob();
      const plyArrayBuffer = await plyBlob.arrayBuffer();

      
    setThreeDModel(plyArrayBuffer.slice(0));
      setShow3DViewer(true);
      // Force re-render of 3D viewer
       const container = document.getElementById('three-container');
       if (container) {
         container.innerHTML = '';
       }
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
            onLoad={(e) => {
              const img = e.target;
              const rect = img.getBoundingClientRect();
              setSegmentationData(prev => ({
                ...prev,
                displayWidth: rect.width,
                displayHeight: rect.height,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight
              }));
            }}
          />


                 {/* 3D Viewer Overlay */}
      {threeDModel && segmentationData.imageUrl && (
        <div
          id="three-container"
          style={{
            position: 'absolute',
            top: `${(segmentationData.bbox?.minY ?? 0) * 100}%`,
            left: `${(segmentationData.bbox?.minX ?? 0) * 100}%`,
            width: `${((segmentationData.bbox?.maxX ?? 1) - (segmentationData.bbox?.minX ?? 0)) * 100}%`,
            height: `${((segmentationData.bbox?.maxY ?? 1) - (segmentationData.bbox?.minY ?? 0)) * 100}%`,
            zIndex: 10,
            pointerEvents: 'none',
            borderRadius: '8px',
            overflow: 'hidden',
            transform: 'translateZ(0)',
            display: show3DViewer ? 'block' : 'none' // ← This controls visibility
          }}
        ></div>
      )}


                
            {/* Segmentation Mask Container (only show when 3D is not visible) */}
            {segmentationData.mask && !show3DViewer && (
                  <img
                    src={segmentationData.mask}
                    alt="Segmentation result"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      opacity: 0.7
                    }}
                  />
                )}
                
                 {/* Segmentation Points (only show when 3D is not visible) */}
              {segmentationData.imageUrl === msg.content && !show3DViewer && (
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
                
                 {/* Control Buttons */}
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
                  
                  {/* Toggle 3D View Button */}
                  {threeDModel && (
                    <button 
                      className="toggle-3d-btn"
                      onClick={() => setShow3DViewer(!show3DViewer)}
                    >
                      {show3DViewer ? 'Hide 3D' : 'Show 3D'}
                    </button>
                  )}
                  
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