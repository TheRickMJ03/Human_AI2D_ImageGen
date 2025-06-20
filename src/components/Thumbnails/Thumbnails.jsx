import React, { useState, useEffect } from 'react';
import './Thumnails.css';
import BiggerImage  from '../Bigger_Image/Bigger_Image';

const Thumbnails = ({ images, loading, isGallery }) => {
  const [selectedImage, setSelectedImage] = useState(null);

  

  useEffect(() => {
    setSelectedImage(null);
  }, [images]);

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }


  return (
    <div className="p-4 w-full bg-white"> { }
      <h2 className="text-2xl font-bold mb-4">
        {isGallery ? 'Gallery History' : 'Generation History'}
      </h2>

      {images.length === 0 ? (
        <p className="text-gray-500">
          {isGallery ? 'No images in gallery yet.' : 'No images generated yet.'}
        </p>
      ) : (
        <div className="slider-container w-full bg-white"> {}
          <div className="slider-track bg-white"> {}
            {images.map((img, index) => (
              <div 
                key={`${img.id}-${index}`} 
                className="thumbnail-card"
                onClick={() => setSelectedImage(img)}
              >
                <div className="thumbnail-image-container">
                  <img
                    src={`http://localhost:5000${img.url}`}
                    alt={img.prompt}
                    className="thumbnail-image"
                    loading="lazy"
                  />
                </div>
                <div className="thumbnail-info">
                  <p className="thumbnail-prompt truncate" title={img.prompt}>
                    {img.prompt}
                  </p>
                  <p className="thumbnail-timestamp">
                    {new Date(img.timestamp || Date.now()).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <BiggerImage image={selectedImage} onClose={() => setSelectedImage(null)} />


    </div>
  );
};

export default Thumbnails;