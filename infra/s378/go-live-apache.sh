#!/bin/bash
set -e
sudo cp ~/dev-vhosts/dev.aitutor.eduai.ok.ubc.ca.conf /etc/httpd/conf.d/
sudo cp ~/dev-vhosts/dev.questionmaker.eduai.ok.ubc.ca.conf /etc/httpd/conf.d/
sudo httpd -t
sudo systemctl reload httpd
echo APACHE_OK
