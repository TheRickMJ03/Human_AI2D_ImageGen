import React from 'react';
import './Bigger_Image.css'


const Bigger_Image = ({ image, onClose }) => {
  if (!image) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <img
          src={`http://localhost:5000${image.url}`}
          alt={image.prompt}
          className="modal-image"
        />
        <p className="modal-prompt">{image.prompt}</p>
        <button className="modal-close-button" onClick={onClose}>✕</button>
      </div>
    </div>
  );
};

export default Bigger_Image;
