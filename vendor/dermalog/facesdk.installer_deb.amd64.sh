#!/bin/bash

if [ "$EUID" -ne 0 ]
  then echo "Please run as root"
  exit
fi

FILES="packages/dermalog-inferenceplugin-onnxruntime_1.3.1.2627-1_amd64.deb packages/dermalog-imageexchange_1.4.0.2627-1_amd64.deb packages/dermalog-facedetection2_6.5.0.2627-1_amd64.deb packages/dermalog-faceexpression2_6.5.0.2627-1_amd64.deb packages/dermalog-faceicaocheck3_6.4.0.2627-1_amd64.deb packages/dermalog-facerecognition3_6.2.1.2617-1_amd64.deb packages/dermalog-facetracking2_6.3.0.2627-1_amd64.deb packages/dermalog-faceliveness2_6.9.0.2627-1_amd64.deb"

FILES_DEVEL="packages/dermalog-sdkheader-devel-1.1.7-0_all.deb packages/dermalog-dataexchange-devel_1.0.2.2441-1_all.deb packages/dermalog-imageexchange-devel_1.4.0.2627-1_all.deb packages/dermalog-inferenceplugin-onnxruntime-devel_1.3.1.2627-1_all.deb packages/dermalog-facedetection2-devel_6.5.0.2627-1_all.deb packages/dermalog-faceexpression2-devel_6.5.0.2627-1_all.deb packages/dermalog-faceicaocheck3-devel_6.4.0.2627-1_all.deb packages/dermalog-faceliveness2-devel_6.9.0.2627-1_all.deb packages/dermalog-facerecognition3-devel_6.2.1.2617-1_all.deb packages/dermalog-facetracking2-devel_6.3.0.2627-1_all.deb packages/dermalog-facesdk-tutorials-cpp-devel_1.0.3.2619-1_all.deb packages/dermalog-wrapper-common-java_1.2.3.2626-1_all.deb packages/dermalog-dataexchange-java_1.0.7.2442-1_all.deb packages/dermalog-imageexchange-java_1.3.0.2539-1_all.deb packages/dermalog-facedetection2-java_1.4.0.2605-1_all.deb packages/dermalog-faceexpression2-java_1.3.0.2507-1_all.deb packages/dermalog-faceicaocheck3-java_1.2.0.2605-1_all.deb packages/dermalog-faceliveness2-java_1.4.1.2626-1_all.deb packages/dermalog-facerecognition3-java_1.3.0.2605-1_all.deb packages/dermalog-facetracking2-java_1.3.0.2605-1_all.deb packages/dermalog-facedetection2-tutorial-java_1.1.2.2451-1_all.deb packages/dermalog-faceexpression2-tutorial-java_1.1.4.2451-1_all.deb packages/dermalog-faceicaocheck3-tutorial-java_1.0.7.2627-1_all.deb packages/dermalog-faceliveness2-tutorial-java_1.4.0.2626-1_all.deb packages/dermalog-facerecognition3-tutorial-java_1.1.0.2516-1_all.deb packages/dermalog-facetracking2-tutorial-java_1.1.3.2451-1_all.deb packages/dermalog-facesdk_6.13.0-1_amd64.deb packages/dermalog-facesdk-devel_6.13.0-1_all.deb"

PACKAGES="dermalog-facesdk-devel dermalog-facesdk dermalog-facetracking2-tutorial-java dermalog-facerecognition3-tutorial-java dermalog-faceliveness2-tutorial-java dermalog-faceicaocheck3-tutorial-java dermalog-faceexpression2-tutorial-java dermalog-facedetection2-tutorial-java dermalog-facetracking2-java dermalog-facerecognition3-java dermalog-faceliveness2-java dermalog-faceicaocheck3-java dermalog-faceexpression2-java dermalog-facedetection2-java dermalog-imageexchange-java dermalog-dataexchange-java dermalog-wrapper-common-java dermalog-facesdk-tutorials-cpp-devel dermalog-facetracking2-devel dermalog-facerecognition3-devel dermalog-faceliveness2-devel dermalog-faceicaocheck3-devel dermalog-faceexpression2-devel dermalog-facedetection2-devel dermalog-inferenceplugin-onnxruntime-devel dermalog-imageexchange-devel dermalog-dataexchange-devel dermalog-sdkheader-devel dermalog-faceliveness2 dermalog-facetracking2 dermalog-facerecognition3 dermalog-faceicaocheck3 dermalog-faceexpression2 dermalog-facedetection2 dermalog-imageexchange dermalog-inferenceplugin-onnxruntime"

INST_OPT_0="Cancel installation"
INST_OPT_1="Install Face SDK runtime with development files (default)"
INST_OPT_2="Install Face SDK runtime only"
INST_OPT_3="Uninstall all Face SDK components"

drm_ask_for_install_option() {
	echo "Please select the Face SDK installation option:"
	echo "(1) $INST_OPT_1"
	echo "(2) $INST_OPT_2"
	echo "(3) $INST_OPT_3"
	echo "(0) $INST_OPT_0"
	echo -n "[1/2/3/0] "
	read DRM_INSTALL_OPTION
	if [[ -z $DRM_INSTALL_OPTION ]]; then
		DRM_INSTALL_OPTION=1
	fi
}

drm_install_prerequisites_dev() {
   apt-get install -y cmake
}

# install packages and report errors
install_packages() {
    local packages=("$@")
    local error=0          
    local failed_packages=() 

    # Loop over each package and attempt to install
    for pkg in "${packages[@]}"; do
        echo "Attempting to install $pkg..."
        dpkg -i "$pkg"
        if [ $? -ne 0 ]; then
            echo "Failed to install $pkg"
            failed_packages+=("$pkg")  
            error=1
        fi
    done

    # Check if there were any errors
    if [ $error -ne 0 ]; then
        echo "Some packages failed to install:"
        for pkg in "${failed_packages[@]}"; do
            echo "- $pkg"
        done
        exit 1  
    else
        echo "All packages installed successfully."
        return 0
    fi
}

echo -e "Dermalog Face SDK installer\n"
drm_ask_for_install_option
while [[ ! $DRM_INSTALL_OPTION =~ ^[0-9]+$ ]] || [[ $DRM_INSTALL_OPTION -lt 0 ]] || [[ $DRM_INSTALL_OPTION -gt 3 ]]; do
	echo -e "Invalid install option selected: $DRM_INSTALL_OPTION\n"
	drm_ask_for_install_option
done


case $DRM_INSTALL_OPTION in
	0)
		echo "selected: $INST_OPT_0"
		echo -e "Installation aborted..."
		exit 0
		;;
	1)
		echo "selected: $INST_OPT_1"
		drm_install_prerequisites_dev
		install_packages $FILES
		install_packages $FILES_DEVEL
		echo -e "\nInstallation completed in /opt/dermalog..."
		;;
	2)
		echo "selected: $INST_OPT_2"
		install_packages $FILES
		echo -e "\nInstallation completed in /opt/dermalog..."
		;;
	3)
		echo "selected: $INST_OPT_3"
		for PKG in $PACKAGES; do
			dpkg -P $PKG
		done
		echo -e "\nUninstall completed..."
		;;
esac
