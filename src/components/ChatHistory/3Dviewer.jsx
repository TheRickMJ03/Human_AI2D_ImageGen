import { useEffect, useRef, useState } from "react";
import './3Dviewer.css';

const ThreeDViewer = ({ threeDModel, bboxs, imageDisplaySize, show3DViewer, setShow3DViewer, setError }) => {
  const [isLoadingLibraries, setIsLoadingLibraries] = useState(false);
  const isLoadingLibrariesRef = useRef(false);

  useEffect(() => {
    isLoadingLibrariesRef.current = isLoadingLibraries;
  }, [isLoadingLibraries]);

  useEffect(() => {
    let renderer, scene, camera, animationId, controls, spark;

    if (threeDModel && !isLoadingLibrariesRef.current) {
      const loadAndRender = async () => {
        setIsLoadingLibraries(true);
        setError(null);

        try {
          // ✅ Load libraries safely
          let OrbitControls, SplatMesh, SparkRenderer, THREE;
          try {
            ({ OrbitControls } = await import("three/examples/jsm/controls/OrbitControls"));
            ({ SplatMesh, SparkRenderer } = await import("@sparkjsdev/spark"));
            THREE = await import("three");
          } catch (err) {
            console.error("Failed to import 3D libraries:", err);
            throw new Error("Failed to import 3D libraries");
          }

          // ✅ WebGL check
          const canvas = document.createElement("canvas");
          const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
          if (!gl) throw new Error("WebGL not supported");

          // Scene & camera
          const container = document.getElementById("three-container");
          scene = new THREE.Scene();
          camera = new THREE.PerspectiveCamera(
            60,
            container.clientWidth / container.clientHeight,
            0.1,
            70
          );

          // ✅ SparkRenderer required
          try {
            spark = new SparkRenderer({ renderer: null });
            scene.add(spark);
          } catch (err) {
            console.error("Failed to initialize SparkRenderer:", err);
            throw new Error("SparkRenderer initialization failed");
          }

          // ✅ Lights
          scene.add(new THREE.AmbientLight(0x404040));
          const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
          dirLight.position.set(1, 1, 1);
          scene.add(dirLight);

          // Load 3D model
          const blob = new Blob([threeDModel], { type: "application/octet-stream" });
          const url = URL.createObjectURL(blob);

          let splatMesh;
          try {
            splatMesh = new SplatMesh({ url });
          } catch (err) {
            console.error("Failed to create SplatMesh:", err);
            throw new Error("SplatMesh creation failed");
          } finally {
            URL.revokeObjectURL(url);
          } 

          console.log('BBox data:', bboxs);
          console.log('Image display size:', imageDisplaySize);
          console.log('Container size:', { width: container.clientWidth, height: container.clientHeight });

          // ✅ BEST APPROACH: Match 3D object size to segmented object display size
          const bbox = bboxs || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
          
          // Calculate segmented object size in display pixels
          const bboxWidthNormalized = bbox.maxX - bbox.minX;
          const bboxHeightNormalized = bbox.maxY - bbox.minY;
          const bboxCenterX = (bbox.minX + bbox.maxX) / 2;
          const bboxCenterY = (bbox.minY + bbox.maxY) / 2;

          // Convert normalized bbox to display pixels
          const bboxWidthPixels = bboxWidthNormalized * imageDisplaySize.width;
          const bboxHeightPixels = bboxHeightNormalized * imageDisplaySize.height;
          
          // Calculate object size relative to container
          const containerToImageRatio = Math.min(
            container.clientWidth / imageDisplaySize.width,
            container.clientHeight / imageDisplaySize.height
          );
          
          // Size the 3D object to match the display size of the segmented object
          const objectDisplayWidth = bboxWidthPixels * containerToImageRatio;
          const objectDisplayHeight = bboxHeightPixels * containerToImageRatio;
          
          // Use the larger dimension for uniform scaling
          const objectSize = Math.max(objectDisplayWidth, objectDisplayHeight) / container.clientWidth;
          
          // Scale the 3D object to match the display size
          const objectScale = objectSize * 2; // Adjust multiplier as needed
          
          // Position the object at the correct location
          const containerAspect = container.clientWidth / container.clientHeight;
          const imageAspect = imageDisplaySize.width / imageDisplaySize.height;
          
          let imageScale, imageOffsetX = 0, imageOffsetY = 0;
          
          if (containerAspect > imageAspect) {
            // Container is wider - image height determines scale
            imageScale = 2 / containerAspect;
          } else {
            // Container is taller - image width determines scale  
            imageScale = 2;
            imageOffsetY = (1 - (imageAspect / containerAspect)) * 0.5;
          }
          
          const positionX = (bboxCenterX - 0.5) * imageScale + imageOffsetX;
          const positionY = (0.5 - bboxCenterY) * (imageScale / containerAspect) + imageOffsetY;

          splatMesh.scale.set(objectScale, objectScale, objectScale);
          splatMesh.position.set(positionX, positionY, 0);

          console.log('Object size matching:', {
            bboxWidthPixels,
            bboxHeightPixels,
            objectDisplayWidth,
            objectDisplayHeight,
            objectSize,
            objectScale,
            containerToImageRatio
          });

          // Perfect camera positioning to frame the object
          const objectDiagonal = Math.sqrt(bboxWidthNormalized * bboxWidthNormalized + bboxHeightNormalized * bboxHeightNormalized);
          const objectScreenSize = objectDiagonal * objectScale;
          
          // Calculate perfect camera distance to fit object in view
          const fovRadians = camera.fov * (Math.PI / 180);
          const perfectDistance = (objectScreenSize * 0.8) / (2 * Math.tan(fovRadians / 2));
          
          // Ensure reasonable limits
          const finalDistance = Math.max(perfectDistance, 0.3);
          
          camera.position.set(positionX, positionY, finalDistance);
          camera.lookAt(positionX, positionY, 0);

          console.log('Perfect camera setup:', {
            objectDiagonal,
            objectScreenSize,
            perfectDistance,
            finalDistance
          });

          //Debug visualization
          const debugPlaneGeometry = new THREE.PlaneGeometry(2, 2 / containerAspect);
          const debugPlaneMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xff0000, 
            wireframe: true, 
            transparent: true, 
            opacity: 0.1 
          });
          const debugPlane = new THREE.Mesh(debugPlaneGeometry, debugPlaneMaterial);
          scene.add(debugPlane);

          // Debug: Show segmented object area
          const bboxGeometry = new THREE.PlaneGeometry(
            bboxWidthNormalized * imageScale, 
            bboxHeightNormalized * (imageScale / containerAspect)
          );
          const bboxMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00, 
            wireframe: true, 
            transparent: true, 
            opacity: 0.3 
          });
          const bboxVisual = new THREE.Mesh(bboxGeometry, bboxMaterial);
          bboxVisual.position.set(positionX, positionY, 0.05);
          scene.add(bboxVisual);

          scene.add(splatMesh);
          splatMesh.rotation.y = -Math.PI/2;

          // Renderer
          renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true,
          });
          renderer.setPixelRatio(window.devicePixelRatio);
          renderer.setSize(container.clientWidth, container.clientHeight, false);
          renderer.domElement.style.width = "100%";
          renderer.domElement.style.height = "100%";
          renderer.domElement.style.display = "block";

          renderer.setClearColor(0x000000, 0);
          container.innerHTML = "";
          container.appendChild(renderer.domElement);

          // Attach renderer to SparkRenderer
          spark.renderer = renderer;

          // ✅ Orbit controls centered on object
          controls = new OrbitControls(camera, renderer.domElement);
          controls.target.set(positionX, positionY, 0);
          controls.enableDamping = true;
          controls.dampingFactor = 0.05;
          controls.screenSpacePanning = false;
          controls.minDistance = finalDistance * 0.3;
          controls.maxDistance = finalDistance * 3;
          controls.update();

          // Animation loop
          const animate = () => {
            animationId = requestAnimationFrame(animate);
            try {
              controls.update();
              renderer.render(scene, camera);
            } catch (err) {
              console.error("Render loop error:", err);
              if (animationId) cancelAnimationFrame(animationId);
              setError(err?.message || "Unknown render error during animation");
              setShow3DViewer(false);
            }
          };
          animate();

          // Resize handler
          const handleResize = () => {
            if (container) {
              renderer.setSize(container.clientWidth, container.clientHeight, false);
              renderer.domElement.style.width = "100%";
              renderer.domElement.style.height = "100%";
              camera.aspect = container.clientWidth / container.clientHeight;
              camera.updateProjectionMatrix();
              controls.update();
            }
          };
          window.addEventListener("resize", handleResize);

        } catch (err) {
          console.error("Error loading 3D viewer:", err);
          setError(err.message || "Failed to load 3D viewer");
          setShow3DViewer(false);
        } finally {
          setIsLoadingLibraries(false);
        }
      };
      loadAndRender();
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (controls) controls.dispose();
      if (renderer) {
        try {
          renderer.dispose();
          renderer.forceContextLoss?.();
        } catch (e) {
          console.warn("Error disposing renderer:", e);
        }
      }
      const container = document.getElementById("three-container");
      if (container) container.innerHTML = "";
    };
  }, [threeDModel, bboxs, imageDisplaySize, setError, setShow3DViewer]);

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