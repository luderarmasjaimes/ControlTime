set(VCPKG_TARGET_ARCHITECTURE x64)
set(VCPKG_CRT_LINKAGE dynamic)
set(VCPKG_LIBRARY_LINKAGE static)

set(VCPKG_CMAKE_SYSTEM_NAME Linux)

# Igual que el triplet oficial de vcpkg, mas esta linea: por defecto vcpkg
# compila debug Y release de cada dependencia (el doble de trabajo/memoria).
# El backend solo usa CMAKE_BUILD_TYPE=Release (Dockerfile), y compilar
# tambien debug de OpenCV/ffmpeg/protobuf en paralelo dentro del builder
# de Docker fue la causa real de que Docker Desktop se colgara (EOF/rpc
# error) tres veces seguidas, siempre en el mismo punto (arranque de la
# build debug de protobuf) -- no era un problema de red ni de configuracion
# de features, era presion de memoria evitable.
set(VCPKG_BUILD_TYPE release)
