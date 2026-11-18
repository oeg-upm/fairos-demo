FROM nginx:stable-alpine

# Copy the original web application
COPY src/ /usr/share/nginx/html/

# Expose the Nginx HTTP port
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
