import * as functions from "firebase-functions";

import path = require('path');
import os = require('os');
import Busboy = require('busboy');
import fs = require('fs');
import imagemin = require('imagemin');
import imageminJpegtran = require('imagemin-jpegtran');
// import imageminPngquant = require('imagemin-pngquant');
import admin = require('firebase-admin');

admin.initializeApp()

export const uploadProduct = functions.https.onRequest((req, res) => {
	try{
		if (req.method !== 'POST') {
			return res.status(405).end();
		}
		const busboy = new Busboy({ headers: req.headers });
		const tmpdir = os.tmpdir();
	
		const fields: any = {};
		const uploads = new Map();
	
		busboy.on('field', (fieldname, val) => {
			fields[fieldname] = val;
		});
	
		const fileWrites = new Array();
	
		busboy.on('file', (fieldname, file, filename) => {
			const filepath = path.join(tmpdir, filename);
			uploads.set(fieldname, filepath);
	
			const writeStream = fs.createWriteStream(filepath);
			file.pipe(writeStream);
	
			const promise = new Promise((resolve, reject) => {
				file.on('end', () => {
					writeStream.end();
				});
				writeStream.on('finish', resolve);
				writeStream.on('error', reject);
			});
			fileWrites.push(promise);
		});
	
		busboy.on('finish', async () => {
			await Promise.all(fileWrites);
	
			const uncompressedImagePaths: any = [];
	
			uploads.forEach((_, file: string) => {
				uncompressedImagePaths.push(uploads.get(file))
			})
			const compressedImagePaths = await compressImages(uncompressedImagePaths);
	
			const uploadedImageUrls = await uploadToCloudStorage(compressedImagePaths, 'product-images');
	
			fields['productImages'] = uploadedImageUrls;
			await saveProduct(fields);
	
			for (const file in uploads) {
				fs.unlinkSync(uploads.get(file));
			}
			res.send();
		});
	
		busboy.end(req.rawBody);
	
	}catch (exc){
		console.log('exception')
		console.log(exc)
		res.send()
	}

	
});

const compressImages = async (srcFilePaths: string[]): Promise<string[]> => {
	const tmpdir = os.tmpdir();
	const compressedImages = await imagemin(srcFilePaths, {
		destination: tmpdir,
		plugins: [
			imageminJpegtran(),
			// imageminPngquant({
			//     quality: [0.6, 0.8]
			// })
		]
	});
	return compressedImages.map(im => im.destinationPath);
}

const uploadToCloudStorage = async (srcFilePaths: string[], destinationFolder: string): Promise<string[]> => {
	const bucket = admin.storage().bucket()
	const uploadedFileUrls = [];

	for (const srcFilePathIndex in srcFilePaths) {
		const srcFilePath = srcFilePaths[srcFilePathIndex]
		const fileNameParts = srcFilePath.split('/');
		const fileName = fileNameParts[fileNameParts.length - 1];
		const destinationFilePath = `${destinationFolder}/${fileName}`;
		await bucket.upload(srcFilePath, {
			destination: destinationFilePath
		});

		let downloadURL = await bucket
			.file(destinationFilePath)
			.getSignedUrl({
				action: 'read',
				expires: '03-01-2500'
			});
		uploadedFileUrls.push(downloadURL[0]);

		fs.unlinkSync(srcFilePath);
	}
	return uploadedFileUrls;
}

const saveProduct = async (productData: any): Promise<string> => {
	const db = admin.firestore();
	const product = await db.collection('products').add(productData)
	return product.id;
}
