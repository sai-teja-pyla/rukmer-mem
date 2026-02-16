# Stage 1: Build the React Application
FROM node:22-alpine as build
WORKDIR /app

# 1. Install dependencies
COPY package*.json ./
RUN npm install

# 2. Declare ALL Build Arguments (Must match firebase.js exactly)
ARG VITE_GEMINI_API_KEY
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ARG VITE_API_URL

# 3. Convert Args to ENV (Vite looks for these during 'npm run build')
ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_FIREBASE_MEASUREMENT_ID=$VITE_FIREBASE_MEASUREMENT_ID
ENV VITE_API_URL=$VITE_API_URL

# 4. Copy source and build
COPY . .
RUN npm run build

# Stage 2: Run the Node.js Backend
FROM node:22-alpine
WORKDIR /app

# Copy production dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy the server code AND the React build from Stage 1
COPY . .
COPY --from=build /app/dist ./dist 

# Cloud Run uses Port 8080 by default
EXPOSE 8080

# Start the Node server
CMD ["node", "server.js"]

# Stage 2: Serve with Nginx
#FROM nginx:alpine
#COPY --from=build /app/dist /usr/share/nginx/html
#COPY nginx.conf /etc/nginx/conf.d/default.conf
#EXPOSE 8080
#CMD ["nginx", "-g", "daemon off;"]