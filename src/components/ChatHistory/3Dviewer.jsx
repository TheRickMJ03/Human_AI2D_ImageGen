import { useEffect, useRef, useState } from "react";
import './3Dviewer.css';
// ADDED: OrbitControls will be imported dynamically

const ThreeDViewer = ({ threeDModel, bboxs, imageDisplaySize, show3DViewer, setShow3DViewer, setError, resetViewRef }) => {
  const [isLoadingLibraries, setIsLoadingLibraries] = useState(false);
  const isLoadingLibrariesRef = useRef(false);
  const isMountedRef = useRef(true);

  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const animationIdRef = useRef(null);
  const controlsRef = useRef(null);
  const splatMeshRef = useRef(null);
  const parentGroupRef = useRef(null);
  const cameraRef = useRef(null);
  const sparkRef = useRef(null);
  const isCleaningUpRef = useRef(false);
  const loadPromiseRef = useRef(null);
  const resizeTimeoutRef = useRef(null);

  const handleResize = () => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current || isCleaningUpRef.current) return;
      const container = document.getElementById("three-container");
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (container && renderer && camera) {
        try {
          renderer.setSize(container.clientWidth, container.clientHeight, false);
          camera.aspect = container.clientWidth / container.clientHeight;
          camera.updateProjectionMatrix();
        } catch (e) {
          console.warn("Error in handleResize:", e);
        }
      }
    }, 100);
  };

  useEffect(() => {
    isLoadingLibrariesRef.current = isLoadingLibraries;
  }, [isLoadingLibraries]);

  useEffect(() => {
    isMountedRef.current = true;
    isCleaningUpRef.current = false;

    const cleanup = () => {
      isCleaningUpRef.current = true;
      isMountedRef.current = false;

      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      loadPromiseRef.current = null;
      window.removeEventListener("resize", handleResize);

      if (controlsRef.current) {
        controlsRef.current.dispose();
        controlsRef.current = null;
      }
      if (parentGroupRef.current && sceneRef.current) {
        try {
          sceneRef.current.remove(parentGroupRef.current);
        } catch (e) {}
        parentGroupRef.current = null;
      }
      if (splatMeshRef.current) {
        try {
          if (typeof splatMeshRef.current.dispose === "function") {
            splatMeshRef.current.dispose();
          }
        } catch (e) {}
        splatMeshRef.current = null;
      }
      if (sparkRef.current && sceneRef.current) {
        try {
          sceneRef.current.remove(sparkRef.current);
          sparkRef.current.renderer = null;
        } catch (e) {}
        sparkRef.current = null;
      }
      if (sceneRef.current) {
        try {
          sceneRef.current.clear();
        } catch (e) {}
        sceneRef.current = null;
      }
      if (rendererRef.current) {
        try {
          rendererRef.current.dispose();
          const canvas = rendererRef.current.domElement;
          if (canvas && canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
          }
        } catch (e) {}
        rendererRef.current = null;
      }
      cameraRef.current = null;
      const container = document.getElementById("three-container");
      if (container) container.innerHTML = "";
    };

    if (threeDModel && show3DViewer && !isLoadingLibrariesRef.current) {
      const loadAndRender = async () => {
        const currentLoadPromise = Symbol("loadPromise");
        loadPromiseRef.current = currentLoadPromise;
        try {
          setIsLoadingLibraries(true);
          setError(null);

          let THREE, SplatMesh, SparkRenderer, OrbitControls; 
          try {
            const threeModule = await import("three");
            THREE = threeModule;
            const sparkModule = await import("@sparkjsdev/spark");
            ({ SplatMesh, SparkRenderer } = sparkModule);
            
            const controlsModule = await import("three/examples/jsm/controls/OrbitControls.js");
            OrbitControls = controlsModule.OrbitControls;

          } catch (err) {
            throw new Error("Failed to import libraries: " + err.message);
          }

          const canvasCheck = document.createElement("canvas");
          const gl = canvasCheck.getContext("webgl") || canvasCheck.getContext("experimental-webgl");
          if (!gl) throw new Error("WebGL not supported");

          const container = document.getElementById("three-container");
          if (!container) return;

          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(
            60,
            container.clientWidth / container.clientHeight,
            0.1,
            70
          );
          cameraRef.current = camera;

          camera.position.set(0, 0, 2.0);
          camera.lookAt(0, 0, 0);

          let spark;
          try {
            spark = new SparkRenderer({ renderer: null });
            scene.add(spark);
            sparkRef.current = spark;
          } catch (err) {
            throw new Error("SparkRenderer initialization failed");
          }

          scene.add(new THREE.AmbientLight(0x404040));
          const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
          dirLight.position.set(1, 1, 1);
          scene.add(dirLight);

          let url = null;
          let splatMesh;
          try {
            const blob = new Blob([threeDModel], { type: "application/octet-stream" });
            url = URL.createObjectURL(blob);
            splatMesh = new SplatMesh({ url });
            splatMeshRef.current = splatMesh;
          } finally {
            if (url) URL.revokeObjectURL(url);
          }

          const bbox = bboxs || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
          const bboxWidthNormalized = bbox.maxX - bbox.minX;
          const bboxHeightNormalized = bbox.maxY - bbox.minY;
          const bboxCenterX = (bbox.minX + bbox.maxX) / 2;
          const bboxCenterY = (bbox.minY + bbox.maxY) / 2;
          const bboxWidthPixels = bboxWidthNormalized * imageDisplaySize.width;
          const bboxHeightPixels = bboxHeightNormalized * imageDisplaySize.height;
          const containerToImageRatio = Math.min(
            container.clientWidth / imageDisplaySize.width,
            container.clientHeight / imageDisplaySize.height
          );
          const objectDisplayWidth = bboxWidthPixels * containerToImageRatio;
          const objectDisplayHeight = bboxHeightPixels * containerToImageRatio;
          const objectSize = Math.max(objectDisplayWidth, objectDisplayHeight) / container.clientWidth;
          const objectScale = objectSize * 2;
          const containerAspect = container.clientWidth / container.clientHeight;
          const imageAspect = imageDisplaySize.width / imageDisplaySize.height;
          let imageScale, imageOffsetY = 0;
          if (containerAspect > imageAspect) {
            imageScale = 2 / containerAspect;
          } else {
            imageScale = 2;
            imageOffsetY = (1 - (imageAspect / containerAspect)) * 0.5;
          }
          const positionX = (bboxCenterX - 0.5) * imageScale;
          const positionY = (0.5 - bboxCenterY) * (imageScale / containerAspect) + imageOffsetY;
          
          const parentGroup = new THREE.Group();
          parentGroupRef.current = parentGroup;
          parentGroup.scale.set(objectScale, objectScale, objectScale);
          parentGroup.position.set(positionX, positionY, 0);
          
          splatMesh.scale.set(1, 1, 1);
          splatMesh.position.set(0, 0, 0);
          splatMesh.rotation.set(0, 0, 0); 
          
          parentGroup.add(splatMesh);
          scene.add(parentGroup);

          // Renderer
          const renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true,
          });
          renderer.setPixelRatio(window.devicePixelRatio);
          renderer.setSize(container.clientWidth, container.clientHeight, false);
          renderer.setClearColor(0x000000, 0);
          container.innerHTML = "";
          container.appendChild(renderer.domElement);

          if (spark) {
            spark.renderer = renderer;
          }

          // Setup OrbitControls
          const controls = new OrbitControls(camera, renderer.domElement);
          controls.target.copy(parentGroup.position); // Look at the object's center
          controls.enableDamping = true; 
          controls.dampingFactor = 0.1;
          controls.screenSpacePanning = true;
          controls.enableZoom = true;
          controls.enableRotate = true;
          controlsRef.current = controls;

          // Reset function
          const initialCameraPosition = camera.position.clone();
          const initialTargetPosition = controls.target.clone();

          resetViewRef.current = () => {
            if (!controlsRef.current || !cameraRef.current) return;
            cameraRef.current.position.copy(initialCameraPosition);
            controlsRef.current.target.copy(initialTargetPosition);
            controlsRef.current.update();
          };

          sceneRef.current = scene;
          rendererRef.current = renderer;

          // animate loop
          const animate = () => {
            if (isCleaningUpRef.current || !isMountedRef.current) return;
            if (!show3DViewer || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
            try {
              if (controlsRef.current) {
                controlsRef.current.update();
              }
              rendererRef.current.render(sceneRef.current, cameraRef.current);
              animationIdRef.current = requestAnimationFrame(animate);
            } catch (err) {
              console.error("Render loop error:", err);
              cancelAnimationFrame(animationIdRef.current);
              setError("Render error");
              setShow3DViewer(false);
            }
          };

          animationIdRef.current = requestAnimationFrame(animate);
          window.addEventListener("resize", handleResize);
        } catch (err) {
          console.error("Error loading viewer:", err);
          setError(err.message);
          setShow3DViewer(false);
        } finally {
          setIsLoadingLibraries(false);
        }
      };
      loadAndRender();
    }

    return () => {
      cleanup();
    };
  }, [threeDModel, bboxs, imageDisplaySize, setError, setShow3DViewer, resetViewRef, show3DViewer]);

  return (
    <div
      id="three-container"
      style={{
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
      }}
    ></div>
  );
};

export default ThreeDViewer;