# Stage 1: Build the React Application
FROM node:22-alpine as build
WORKDIR /app

# 1. Install ALL dependencies (including Vite)
COPY package*.json ./
RUN npm install

# 2. Inject the API Key safely during build
ARG VITE_GEMINI_API_KEY
ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY

# 3. Copy source and build
COPY . .
RUN npm run build

# Stage 2: Serve the App with Nginx (Professional Web Server)
FROM nginx:alpine

# Copy the built files from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

# Copy our custom Nginx config (See step 2 below)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]