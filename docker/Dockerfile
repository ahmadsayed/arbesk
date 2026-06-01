FROM ipfs/kubo:latest

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Ensure ipfs group exists (base image has user but not always the group)
RUN addgroup ipfs 2>/dev/null || true
RUN mkdir -p /data/ipfs && chown -R ipfs:ipfs /data/ipfs

ENV IPFS_PATH=/data/ipfs

EXPOSE 5001 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
