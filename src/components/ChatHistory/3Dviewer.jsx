import { useEffect, useRef, useState } from "react";
import './3Dviewer.css';

const ThreeDViewer = ({ threeDModel, bboxs, imageDisplaySize, show3DViewer, setShow3DViewer, setError, resetViewRef }) => {
 
      // threeDModel → the binary data of the 3D model.

      // bboxs → bounding box coordinates (minX, maxX, etc.).

      // imageDisplaySize → { width, height } of the image the 3D model aligns with.

      // show3DViewer → whether the viewer should be displayed.

      // setShow3DViewer → toggles visibility.

      // setError → sets an error message if something fails.

      // resetViewRef → a React ref that will later hold a function to reset the camera view.


 
 
 
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
            // Dynamically import Three.js
            const threeModule = await import("three");
            THREE = threeModule;
            // Dynamically import Spark.js components
            const sparkModule = await import("@sparkjsdev/spark");
            ({ SplatMesh, SparkRenderer } = sparkModule);
            // Dynamically import OrbitControls
            const controlsModule = await import("three/examples/jsm/controls/OrbitControls.js");
            OrbitControls = controlsModule.OrbitControls;
          } catch (err) {
            throw new Error("Failed to import libraries: " + err.message);
          }

          const canvasCheck = document.createElement("canvas");
          const gl = canvasCheck.getContext("webgl") || canvasCheck.getContext("experimental-webgl");
          if (!gl) throw new Error("WebGL not supported");

          // Get the container element
          const container = document.getElementById("three-container");
          if (!container) return;

          // Scene, Camera, & Light Setup 
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(
            60, // Field of View
            container.clientWidth / container.clientHeight, // Aspect Ratio
            0.1, // Near clipping plane
            70   // Far clipping plane
          );
          cameraRef.current = camera;

          camera.position.set(0, 0, 2.0); // Set initial camera position
          camera.lookAt(0, 0, 0);

          // Initialize SparkRenderer (for Gaussian Splatting)
          let spark;
          try {
            spark = new SparkRenderer({ renderer: null });
            scene.add(spark);
            sparkRef.current = spark;
          } catch (err) {
            throw new Error("SparkRenderer initialization failed");
          }


          // Add basic lighting
          scene.add(new THREE.AmbientLight(0x404040));
          const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
          dirLight.position.set(1, 1, 1);
          scene.add(dirLight);

          let url = null;
          //Loads the binary 3d data into the mesh
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
          // //this helps vizualize where the camera is pointing after using please comment out
          // const helper = new THREE.CameraHelper(camera);
          // scene.add(helper);

          console.log("--- 3D Viewer Debug Start ---");
          console.log("Using bbox:", JSON.parse(JSON.stringify(bbox)));
          console.log("ImageDisplaySize (w, h):", imageDisplaySize.width, imageDisplaySize.height);
          console.log("Container Size (w, h):", container.clientWidth, container.clientHeight);

          const bboxWidthNormalized = bbox.maxX - bbox.minX;
          console.log("bboxWidthNormalized (0-1):", bboxWidthNormalized);

          const bboxHeightNormalized = bbox.maxY - bbox.minY;
          console.log("bboxHeightNormalized (0-1):", bboxHeightNormalized);

          const bboxCenterX = (bbox.minX + bbox.maxX) / 2;
          console.log("bboxCenterX (0-1):", bboxCenterX);

          const bboxCenterY = (bbox.minY + bbox.maxY) / 2;
          console.log("bboxCenterY (0-1):", bboxCenterY);

          const bboxWidthPixels = bboxWidthNormalized * imageDisplaySize.width;
          console.log("bboxWidthPixels (on original image):", bboxWidthPixels);

          const bboxHeightPixels = bboxHeightNormalized * imageDisplaySize.height;
          console.log("bboxHeightPixels (on original image):", bboxHeightPixels);

          const containerToImageRatio = Math.min(
            container.clientWidth / imageDisplaySize.width,
            container.clientHeight / imageDisplaySize.height
          );
          console.log("containerToImageRatio (scale factor for 'fit'):", containerToImageRatio);

          const objectDisplayWidth = bboxWidthPixels * containerToImageRatio;
          console.log("objectDisplayWidth (in container px):", objectDisplayWidth);

          const objectDisplayHeight = bboxHeightPixels * containerToImageRatio;
          console.log("objectDisplayHeight (in container px):", objectDisplayHeight);

          const objectSize = Math.max(objectDisplayWidth, objectDisplayHeight) / container.clientWidth;
          console.log("objectSize (normalized to container width):", objectSize);

          const objectScale = objectSize * 2;
          console.log("FINAL objectScale (for Three.js):", objectScale);

          const containerAspect = container.clientWidth / container.clientHeight;
          console.log("containerAspect:", containerAspect);

          const imageAspect = imageDisplaySize.width / imageDisplaySize.height;
          console.log("imageAspect:", imageAspect);

          let imageScale, imageOffsetY = 0;
          if (containerAspect > imageAspect) {
            // Container is WIDER (Letterbox)
            imageScale = 2 / containerAspect;
            console.log("Case: Letterbox (container wider)");
          } else {
            // Container is TALLER (Pillarbox)
            imageScale = 2;
            imageOffsetY = (1 - (imageAspect / containerAspect)) * 0.5;
            console.log("Case: Pillarbox (container taller)");
          }
          console.log("imageScale (Three.js units):", imageScale);
          console.log("imageOffsetY (Three.js units):", imageOffsetY);

          //THIS is just a logic I was trying to implement last friday pretty much it calculates the visible height and visible width, it looks like it did not work 
      
          function getViewSizeAtDepth(camera, depth) {
            const vFOV = THREE.MathUtils.degToRad(camera.fov);
            const height = 2 * Math.tan(vFOV / 2) * depth;
            const width = height * camera.aspect;
            const bounds = {
              left: -width / 2,
              right: width / 2,
              top: height / 2,
              bottom: -height / 2,
              z: -camera.position.z
            };
//---------------------------------------------------------------------------------------
            console.log("These are the boundaries ",bounds);
            return { width, height };
          }





          const view = getViewSizeAtDepth(camera, 2);
          console.log(view.width, view.height);


          const positionX = (bboxCenterX - 0.5) * imageScale;
          console.log("FINAL positionX (Three.js units):", positionX);

          // (0.5 - bboxCenterY) flips Y-axis and converts to [-0.5, 0.5] range
          const positionY = (0.5 - bboxCenterY) * (imageScale / containerAspect) + imageOffsetY;
          console.log("FINAL positionY (Three.js units):", positionY);

          const parentGroup = new THREE.Group();
          parentGroupRef.current = parentGroup;
          parentGroup.scale.set(objectScale, objectScale, objectScale);
          console.log("Applying scale to parentGroup:", objectScale);

          parentGroup.position.set(positionX,positionY, objectScale);
          console.log(" parentGroup position :",parentGroup.position);
          console.log("--- 3D Viewer Debug End ---");
            
          
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
    ></div>
  );
};

export default ThreeDViewer;