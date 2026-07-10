# Build stage
FROM node:18-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY --from=build /app/dist ./dist
# Copy the Dialogflow credentials if they exist
COPY *.json ./

EXPOSE 8000

CMD ["node", "dist/index.js"]
