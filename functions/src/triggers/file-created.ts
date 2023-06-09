import {Storage} from '@google-cloud/storage';
import {SHARED_CONFIG} from 'definitions';
import {firestore} from 'firebase-admin';
import * as functions from 'firebase-functions';
import {ObjectMetadata} from 'firebase-functions/v1/storage';
import {unlink} from 'fs';
import {tmpdir} from 'os';
import {basename, dirname, join} from 'path';
import sharp from 'sharp';
import {promisify} from 'util';
import {unpackGenerateImageString} from '../utils/unpack-generate-image-string';

export const fileCreated = functions
  .region(SHARED_CONFIG.cloudRegion)
  .runWith({
    memory: '1GB',
    timeoutSeconds: 300
  })
  .storage.object()
  .onFinalize(async ({bucket, name, contentType, metadata, timeCreated, size}: ObjectMetadata) => {
    const storageColl = firestore().collection('storage');
    const fileName = basename(name);
    const dirName = dirname(name);
    const folders = {};

    /**
     * Storage
     */
    const storageDocument = {
      name: fileName,
      path: dirName,
      type: name.endsWith('/') ? 'folder' : 'file',
      metadata: metadata || {},
      contentType: contentType || '',
      createdOn: new Date(timeCreated).getTime(),
      size: Number(size || 0)
    };
    const previousStorageDocument = await storageColl
      .where('name', '==', storageDocument.name)
      .where('path', '==', storageDocument.path).get().then(snapshot => {
        if (snapshot.empty) {
          return null;
        }
        return {
          id: snapshot.docs[0].id,
          ...snapshot.docs[0].data()
        };
      });

    if (previousStorageDocument) {
      await storageColl.doc(previousStorageDocument.id).set(storageDocument, {merge: true});
    } else {
      await storageColl.add(storageDocument);
    }

    /**
     * Mimic folder documents since they are not created by the Firebase
     */
    const paths = storageDocument.path.split('/');
    for (let i = 0; i < paths.length; i++) {
      const parentPath = paths.slice(0, i + 1).join('/');

      if (!parentPath || parentPath === '.') {
        continue;
      }


      if (!folders[parentPath]) {
        folders[parentPath] = {
          name: paths[i],
          path: paths.slice(0, i).join('/') || '.',
          type: 'folder',
          metadata: {},
          contentType: 'text/plain',
          createdOn: storageDocument.createdOn,
          size: 0
        };
      }

      if (storageDocument.createdOn < folders[parentPath].createdOn) {
        folders[parentPath].createdOn = storageDocument.createdOn;
      }
    }

    for (const [_, folder] of Object.entries(folders)) {
      const previousFolder = await storageColl
        .where('name', '==', (folder as any).name)
        .where('path', '==', (folder as any).path).get();

      if (previousFolder.empty) {
        await storageColl.add(folder);
      }
    }

    /**
     * Skip if the file is already a thumb or is autogenerated
     * or there aren't any meta files to generate
     */
    if (
      !contentType.startsWith('image/') ||
      !metadata ||
      !metadata['generate_1'] ||
      metadata.generated
    ) {
      return;
    }

    /**
     * Temporary main file download
     */
    const fileTemp = join(tmpdir(), fileName);
    const toGenerate = [];
    const webpToGenerate = [];

    for (const key in metadata) {
      if (key.includes('generate_')) {
        const {
          filePrefix,
          height,
          width,
          webpVersion,
          folder
        } = unpackGenerateImageString(metadata[key]);
        const fName = (filePrefix || '') + fileName;
        const tmpDir = join(tmpdir(), fName);

        if (filePrefix || width || height) {
          toGenerate.push({
            tmpDir,
            fName,
            height,
            width,
            folder: folder || 'generated'
          });
        }

        if (webpVersion) {
          webpToGenerate.push({
            folder: folder || 'generated',
            fName: fName.replace(/(.jpg|.png|.jpeg)/i, '.webp'),
            source: tmpDir,
            destination: tmpDir.replace(/(.jpg|.png|.jpeg)/i, '.webp')
          });
        }
      }
    }

    const generateMetadata = {
      generated: 'true',
      source: fileName,
      moduleId: metadata.moduleId,
      documentId: metadata.documentId
    };

    const storage = new Storage().bucket(bucket);
    await storage.file(name).download({
      destination: fileTemp
    });

    await Promise.all(
      toGenerate.map(async file => {
        const buffer = await sharp(fileTemp)
          .resize(file.width || null, file.height || null, {fit: 'inside'})
          .withMetadata()
          .toBuffer();

        return sharp(buffer).toFile(file.tmpDir);
      })
    );

    if (webpToGenerate.length) {
      await Promise.all(
        webpToGenerate.map(async file => {
          const buffer = await sharp(file.source)
            .webp({lossless: true})
            .toBuffer();

          return sharp(buffer).toFile(file.destination);
        })
      );
    }

    await Promise.all([
      ...toGenerate.map(file =>
        storage.upload(file.tmpDir, {
          metadata: {
            metadata: generateMetadata,
            contentType
          },
          destination: join(dirName, file.folder, file.fName)
        })
      ),

      ...webpToGenerate.map(file =>
        storage.upload(file.destination, {
          metadata: {
            metadata: generateMetadata,
            contentType: 'image/webp'
          },
          destination: join(dirName, file.folder, file.fName)
        })
      )
    ]);

    const unLink = promisify(unlink);

    await Promise.all(toGenerate.map(it => unLink(it.tmpDir)));
    return true;
  });
