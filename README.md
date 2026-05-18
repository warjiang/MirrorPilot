# sync-images


## usage
1. Add GitHub Actions secrets in your repository:
   - `ALIYUN_REGISTRY`: your aliyun registry host and namespace, for example `registry.cn-shanghai.aliyuncs.com/<namespace>`
   - `ALIYUN_REGISTRY_USER`: your aliyun registry username
   - `ALIYUN_REGISTRY_PASSWORD`: your aliyun registry password
2. Update images you wanted to sync in `images.list` in format of `${origin_image}=>${target_image}`.
3. Add, commit and push the changes, then images will be synced to aliyun registry automatically.
4. If you don't want to sync some images, comment lines by adding prefix `#`.
