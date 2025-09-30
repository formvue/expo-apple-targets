import { ConfigPlugin, withDangerousMod } from "@expo/config-plugins";
import { generateImageAsync } from "@expo/image-utils";
import {
  ContentsJson,
  ContentsJsonImageIdiom,
  writeContentsJsonAsync,
} from "@expo/prebuild-config/build/plugins/icons/AssetContents";
import * as fs from "fs";
import { join } from "path";

import { ExtensionType } from "../target";

// TODO: support dark, tinted, and universal icons for widgets.
export const withIosIcon: ConfigPlugin<{
  cwd: string;
  type: ExtensionType;
  iconFilePath: string;
  isTransparent?: boolean;
}> = (config, { cwd, type, iconFilePath, isTransparent = false }) => {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const namedProjectRoot = join(projectRoot, cwd);
      if (type === "watch") {
        // Ensure the Images.xcassets/AppIcon.appiconset path exists
        await fs.promises.mkdir(join(namedProjectRoot, IMAGESET_PATH), {
          recursive: true,
        });

        // Finally, write the Config.json
        await writeContentsJsonAsync(join(namedProjectRoot, IMAGESET_PATH), {
          images: await generateWatchIconsInternalAsync(
            iconFilePath,
            projectRoot,
            namedProjectRoot,
            cwd,
            isTransparent
          ),
        });
      } else if (type === "imessage") {
        // Ensure the Assets.xcassets/AppIcon.appiconset path exists
        const iMessageIconPath = "Assets.xcassets/AppIcon.appiconset";
        await fs.promises.mkdir(join(namedProjectRoot, iMessageIconPath), {
          recursive: true,
        });

        // Generate iMessage-specific icons
        await writeContentsJsonAsync(join(namedProjectRoot, iMessageIconPath), {
          images: await generateIMessageIconsInternalAsync(
            iconFilePath,
            projectRoot,
            namedProjectRoot,
            cwd,
            isTransparent
          ),
        });
      } else {
        await setIconsAsync(
          iconFilePath,
          projectRoot,
          join(projectRoot, cwd),
          cwd,
          isTransparent
        );
      }
      return config;
    },
  ]);
};

const IMAGE_CACHE_NAME = "widget-icons-";
const IMAGESET_PATH = "Assets.xcassets/AppIcon.appiconset";

// Hard-coding seemed like the clearest and safest way to implement the sizes.
export const ICON_CONTENTS: {
  idiom: ContentsJsonImageIdiom;
  sizes: { size: number; scales: (1 | 2 | 3)[] }[];
}[] = [
  {
    idiom: "iphone",
    sizes: [
      {
        size: 20,
        scales: [2, 3],
      },
      {
        size: 29,
        scales: [1, 2, 3],
      },
      {
        size: 40,
        scales: [2, 3],
      },
      {
        size: 60,
        scales: [2, 3],
      },
      // TODO: 76x76@2x seems unused now
      // {
      //   size: 76,
      //   scales: [2],
      // },
    ],
  },
  {
    idiom: "ipad",
    sizes: [
      {
        size: 20,
        scales: [1, 2],
      },
      {
        size: 29,
        scales: [1, 2],
      },
      {
        size: 40,
        scales: [1, 2],
      },
      {
        size: 76,
        scales: [1, 2],
      },
      {
        size: 83.5,
        scales: [2],
      },
    ],
  },
  {
    idiom: "ios-marketing",
    sizes: [
      {
        size: 1024,
        scales: [1],
      },
    ],
  },
];

export async function setIconsAsync(
  icon: string,
  projectRoot: string,
  iosNamedProjectRoot: string,
  cacheComponent: string,
  isTransparent: boolean
) {
  // Ensure the Images.xcassets/AppIcon.appiconset path exists
  await fs.promises.mkdir(join(iosNamedProjectRoot, IMAGESET_PATH), {
    recursive: true,
  });

  // Finally, write the Config.json
  await writeContentsJsonAsync(join(iosNamedProjectRoot, IMAGESET_PATH), {
    images: await generateIconsInternalAsync(
      icon,
      projectRoot,
      iosNamedProjectRoot,
      cacheComponent,
      isTransparent
    ),
  });
}

export async function generateIconsInternalAsync(
  icon: string,
  projectRoot: string,
  iosNamedProjectRoot: string,
  cacheComponent: string,
  isTransparent: boolean
) {
  // Store the image JSON data for assigning via the Contents.json
  const imagesJson: ContentsJson["images"] = [];

  // keep track of icons that have been generated so we can reuse them in the Contents.json
  const generatedIcons: Record<string, boolean> = {};

  for (const platform of ICON_CONTENTS) {
    const isMarketing = platform.idiom === "ios-marketing";
    for (const { size, scales } of platform.sizes) {
      for (const scale of scales) {
        // The marketing icon is special because it makes no sense.
        const filename = isMarketing
          ? "ItunesArtwork@2x.png"
          : getAppleIconName(size, scale);
        // Only create an image that hasn't already been generated.
        if (!(filename in generatedIcons)) {
          const iconSizePx = size * scale;

          // Using this method will cache the images in `.expo` based on the properties used to generate them.
          // this method also supports remote URLs and using the global sharp instance.
          const { source } = await generateImageAsync(
            { projectRoot, cacheType: IMAGE_CACHE_NAME + cacheComponent },
            {
              src: icon,
              name: filename,
              width: iconSizePx,
              height: iconSizePx,
              removeTransparency: !isTransparent,
              // The icon should be square, but if it's not then it will be cropped.
              resizeMode: "cover",
              // Force the background color to solid white to prevent any transparency.
              // TODO: Maybe use a more adaptive option based on the icon color?
              backgroundColor: isTransparent ? "#ffffff00" : "#ffffff",
            }
          );
          // Write image buffer to the file system.
          const assetPath = join(iosNamedProjectRoot, IMAGESET_PATH, filename);
          await fs.promises.writeFile(assetPath, source);
          // Save a reference to the generated image so we don't create a duplicate.
          generatedIcons[filename] = true;
        }

        imagesJson.push({
          idiom: platform.idiom,
          size: `${size}x${size}`,
          // @ts-ignore: template types not supported in TS yet
          scale: `${scale}x`,
          filename,
        });
      }
    }
  }

  return imagesJson;
}

export async function generateIMessageIconsInternalAsync(
  icon: string,
  projectRoot: string,
  iosNamedProjectRoot: string,
  cacheComponent: string,
  isTransparent: boolean
) {
  // Store the image JSON data for assigning via the Contents.json
  const imagesJson: ContentsJson["images"] = [];

  // iMessage icon sizes - these are landscape (width x height)
  const iconSizes = [
    { size: "60x45", scales: [2, 3], idiom: "universal", platform: "ios" },
    { size: "67x50", scales: [2], idiom: "universal", platform: "ios" },
    { size: "74x55", scales: [2], idiom: "universal", platform: "ios" },
    { size: "27x20", scales: [2, 3], idiom: "universal", platform: "ios" },
    { size: "32x24", scales: [2, 3], idiom: "universal", platform: "ios" },
    { size: "1024x768", scales: [1], idiom: "universal", platform: "ios" },
    { size: "1024x768", scales: [1], idiom: "ios-marketing", platform: "ios" },
    { size: "1024x1024", scales: [1], idiom: "ios-marketing", platform: "ios" },
  ];

  for (const iconSize of iconSizes) {
    const [width, height] = iconSize.size.split("x").map(Number);

    for (const scale of iconSize.scales) {
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      // Marketing icons don't use @1x suffix
      const filename = iconSize.idiom === "ios-marketing" && scale === 1
        ? `icon-${iconSize.size}.png`
        : `icon-${iconSize.size}@${scale}x.png`;

      // Apple requires the marketing icon (1024x768) to have no transparency
      const isMarketingIcon = iconSize.size === "1024x768" || iconSize.idiom === "ios-marketing";
      const shouldRemoveTransparency = isMarketingIcon ? true : !isTransparent;
      const bgColor = isMarketingIcon ? "#ffffff" : (isTransparent ? "#ffffff00" : "#ffffff");

      // Using this method will cache the images in `.expo` based on the properties used to generate them.
      const { source } = await generateImageAsync(
        { projectRoot, cacheType: IMAGE_CACHE_NAME + cacheComponent },
        {
          src: icon,
          name: filename,
          width: scaledWidth,
          height: scaledHeight,
          removeTransparency: shouldRemoveTransparency,
          resizeMode: "contain", // Maintain aspect ratio for landscape icons
          backgroundColor: bgColor,
        }
      );

      // Write image buffer to the file system.
      const assetPath = join(
        iosNamedProjectRoot,
        "Assets.xcassets/AppIcon.appiconset",
        filename
      );
      await fs.promises.writeFile(assetPath, source);

      // Add to contents.json
      const imageEntry: any = {
        idiom: iconSize.idiom,
        size: iconSize.size,
        scale: `${scale}x`,
        filename,
      };

      if (iconSize.platform) {
        imageEntry.platform = iconSize.platform;
      }

      imagesJson.push(imageEntry);
    }
  }

  return imagesJson;
}

export async function generateWatchIconsInternalAsync(
  icon: string,
  projectRoot: string,
  iosNamedProjectRoot: string,
  cacheComponent: string,
  isTransparent: boolean
) {
  // Store the image JSON data for assigning via the Contents.json
  const imagesJson: ContentsJson["images"] = [];

  const size = 1024;
  const filename = getAppleIconName(size, 1);
  // Using this method will cache the images in `.expo` based on the properties used to generate them.
  // this method also supports remote URLs and using the global sharp instance.
  const { source } = await generateImageAsync(
    { projectRoot, cacheType: IMAGE_CACHE_NAME + cacheComponent },
    {
      src: icon,
      name: filename,
      width: size,
      height: size,
      removeTransparency: !isTransparent,
      // The icon should be square, but if it's not then it will be cropped.
      resizeMode: "cover",
      // Force the background color to solid white to prevent any transparency.
      // TODO: Maybe use a more adaptive option based on the icon color?
      backgroundColor: isTransparent ? "#ffffff00" : "#ffffff",
    }
  );
  // Write image buffer to the file system.
  const assetPath = join(iosNamedProjectRoot, IMAGESET_PATH, filename);
  await fs.promises.writeFile(assetPath, source);

  imagesJson.push({
    filename: getAppleIconName(size, 1),
    idiom: "universal",
    size: `${size}x${size}`,
    platform: "watchos",
  });

  return imagesJson;
}

function getAppleIconName(size: number, scale: number): string {
  return `App-Icon-${size}x${size}@${scale}x.png`;
}
