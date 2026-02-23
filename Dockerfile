FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server/server.js"]
