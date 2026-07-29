# Builds the `pict` CLI (Microsoft's Pairwise Independent Combinatorial Tool) from source,
# pinned to an immutable base image digest and exact package versions — a mutable tag
# (`alpine:3.21`) or an unversioned `apk add` can silently pull a different toolchain on a later
# build, which defeats the whole point of pinning below.
#
# Why this has to run in a container rather than a host install (brew, apt, etc.): PICT's
# greedy solver breaks ties between equally-valid candidate rows via hash-container iteration
# order, which differs across C++ standard library implementations. A macOS/Homebrew build
# (clang + libc++) and a Linux build (g++ + libstdc++) produce a *different row count* for the
# identical model — 19 rows vs 18 for this repo's pilot model, not just a reordering. Since the
# generated JSON is committed and diffed, every environment that generates it must agree
# byte-for-byte, so generation always goes through this one pinned image (Docker is already a
# required dependency for this repo — see README "Getting started").
FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d AS build
RUN apk add --no-cache git=2.47.3-r0 build-base=0.5-r3
RUN git clone --depth 1 --branch v3.7.4 https://github.com/microsoft/pict.git /src \
  && make -C /src

FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d
RUN apk add --no-cache libstdc++=14.2.0-r4
COPY --from=build /src/pict /usr/local/bin/pict
ENTRYPOINT ["pict"]
