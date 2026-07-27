# Builds the `pict` CLI (Microsoft's Pairwise Independent Combinatorial Tool) from source,
# pinned to a fixed base image and tag.
#
# Why this has to run in a container rather than a host install (brew, apt, etc.): PICT's
# greedy solver breaks ties between equally-valid candidate rows via hash-container iteration
# order, which differs across C++ standard library implementations. A macOS/Homebrew build
# (clang + libc++) and a Linux build (g++ + libstdc++) produce the same row *count* for a given
# model but a different row selection/order — confirmed for this repo's pilot model. Since the
# generated JSON is committed and diffed, every environment that generates it must agree
# byte-for-byte, so generation always goes through this one pinned image (Docker is already a
# required dependency for this repo — see README "Getting started").
FROM alpine:3.21 AS build
RUN apk add --no-cache git build-base
RUN git clone --depth 1 --branch v3.7.4 https://github.com/microsoft/pict.git /src \
  && make -C /src

FROM alpine:3.21
RUN apk add --no-cache libstdc++
COPY --from=build /src/pict /usr/local/bin/pict
ENTRYPOINT ["pict"]
