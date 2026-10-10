# CAD-bench's verifier image pins only build123d==0.10.0; ocp_gordon has since
# moved to 0.3.x, which imports OCP.collections from a newer OCP than the
# cadquery-ocp 7.8 build123d 0.10 runs on, so `import build123d` fails and
# every submission - the reference solutions included - scores 0. Pin the last
# ocp_gordon before 0.3 on top of the upstream image, changing nothing else.
FROM ghcr.io/cad-bench/cad-bench-verifier:harbor-v1
RUN uv pip install --system "ocp_gordon==0.2.2"
