FROM node:alpine
ADD bin/ /opt/resource
ADD package.json /opt/resource/package.json

WORKDIR /opt/resource
RUN NODE_ENV=production npm install --quiet
RUN apk update \
  && apk add jq \
  && rm -rf /var/cache/apk/*
RUN ln -sfn /opt/resource/out.js /opt/resource/out
WORKDIR /root
