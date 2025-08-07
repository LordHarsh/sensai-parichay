import { useEffect, useState } from "react";
import { ExamNotification as NotificationType } from "@/types/exam";
import { AlertTriangle, CheckCircle, Info, AlertCircle, X } from "lucide-react";

interface ExamNotificationProps {
  notification: NotificationType;
  onRemove: (id: string) => void;
}

export default function ExamNotification({ notification, onRemove }: ExamNotificationProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    
    if (notification.auto_dismiss !== false) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onRemove(notification.id), 300);
      }, notification.type === 'error' ? 8000 : 5000);
      
      return () => clearTimeout(timer);
    }
  }, [notification.id, notification.type, notification.auto_dismiss, onRemove]);

  const getNotificationStyles = () => {
    const baseStyles = "fixed top-4 right-4 max-w-md p-4 rounded-lg shadow-lg border z-50 transition-all duration-300 transform backdrop-blur-sm";
    
    switch (notification.type) {
      case 'error':
        return `${baseStyles} bg-red-900/90 border-red-500/50 text-red-100`;
      case 'warning':
        return `${baseStyles} bg-amber-900/90 border-amber-500/50 text-amber-100`;
      case 'success':
        return `${baseStyles} bg-emerald-900/90 border-emerald-500/50 text-emerald-100`;
      case 'info':
      default:
        return `${baseStyles} bg-blue-900/90 border-blue-500/50 text-blue-100`;
    }
  };

  const getIcon = () => {
    switch (notification.type) {
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-400" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-400" />;
      case 'success':
        return <CheckCircle className="w-5 h-5 text-emerald-400" />;
      case 'info':
      default:
        return <Info className="w-5 h-5 text-blue-400" />;
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onRemove(notification.id), 300);
  };

  return (
    <div 
      className={`${getNotificationStyles()} ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div className="flex items-start space-x-3">
        <div className="flex-shrink-0 mt-0.5">
          {getIcon()}
        </div>
        
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{notification.message}</p>
          
          {notification.action && (
            <button
              onClick={() => {
                notification.action!.callback();
                handleClose();
              }}
              className="mt-2 text-xs underline hover:no-underline opacity-80 hover:opacity-100 transition-opacity"
            >
              {notification.action.label}
            </button>
          )}
        </div>
        
        <button
          onClick={handleClose}
          className="flex-shrink-0 ml-4 opacity-60 hover:opacity-100 transition-opacity"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
