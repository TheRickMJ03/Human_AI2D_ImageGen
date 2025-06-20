# Human_AI2D_ImageGen

A web-based interface for local AI-powered image generation from text prompts.

## Overview

Human_AI2D_ImageGen is a locally-hosted web application that enables users to generate images from text prompts using AI models. The system consists of:

- React-based frontend interface
- Python Flask backend
- Integration with Hugging Face API (FLUX.1-schnell model)

The application provides a complete workflow for image generation, including prompt input, real-time generation status, image display, and a persistent gallery of previously generated images stored locally.

## Features

### Core Capabilities
- Text-to-image conversion using FLUX.1-schnell model
- Real-time generation status updates via WebSocket
- Local storage with timestamp-based file naming
- Error handling and user feedback

### User Interface
- Responsive prompt input
- Live image display with loading animations
- Persistent gallery view
- Modal image viewing
- Smooth CSS animations

### Data Management
- Local file system storage (`generated_images/` directory)
- Metadata preservation in filenames
- Automatic image history loading
- Cross-session persistence

## 🛠️ Tech Stack

### **Frontend**
| Component        | Technology       | Purpose                          |
|------------------|------------------|----------------------------------|
| Framework        | React.js         | UI components & state management |
| State Management | React Hooks      | Local component state            |
| Real-time Comms  | Socket.IO-client | WebSocket connections            |
| Styling          | CSS              | Visual design & animations       |
| UI Components    | Custom           | Image gallery, modals, forms     |

### **Backend**
| Component        | Technology       | Purpose                          |
|------------------|------------------|----------------------------------|
| Framework        | Python Flask     | API server & routes              |
| WebSockets       | Flask-SocketIO   | Real-time event broadcasting     |
| API Integration  | Hugging Face     | FLUX.1-schnell model access      |
| File Handling    | Python OS module | Local image storage management   |

### **Infrastructure**
| Component        | Technology       | Purpose                          |
|------------------|------------------|----------------------------------|
| API Service      | Hugging Face API | Cloud-based model inference      |
| Storage          | Local Filesystem | Persistent image storage         |
| Security         | .env files       | API token management             |
| Version Control  | Git              | Source code management           |

