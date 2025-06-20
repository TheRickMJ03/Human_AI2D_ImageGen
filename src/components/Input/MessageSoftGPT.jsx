import React from "react";
import "./Input.css";
import telegramFill from "../../assets/186407_arrow_up_icon.png";

export const InputCase = ({ value, onChange, onKeyDown, onSubmit }) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(e);        
  };

  return (
    <div className="input-case">
      <form className="content" onSubmit={handleSubmit}>  {}
          <input
            type="text"
            className="input-field"
            placeholder="Type your next big idea..."
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
          />
          <button 
            className="send-button" 
            type="submit" 
          >
          <img
              className="send-icon"
              alt="Send"
              src={telegramFill}
          />
        </button>
      </form>
    </div>
  );
};