FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html/
COPY 40-fairos-config.sh /docker-entrypoint.d/40-fairos-config.sh
RUN chmod +x /docker-entrypoint.d/40-fairos-config.sh
ENV API_BASE_URL=https://prefairos.linkeddata.es
EXPOSE 80
