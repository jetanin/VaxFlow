# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# --- serve stage (nginx + HTTPS) ---
FROM nginx:alpine
# สร้าง self-signed certificate สำหรับ HTTPS (demo) — production ใช้ Let's Encrypt
RUN apk add --no-cache openssl && mkdir -p /etc/nginx/certs && openssl req -x509 -nodes -days 825 -newkey rsa:2048 -keyout /etc/nginx/certs/key.pem -out /etc/nginx/certs/cert.pem -subj "/C=TH/O=MedCast_Secure/CN=localhost"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
