import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { FirebaseStorageService } from '../storage/storage.service';
import { FirestoreService } from '../firestore/firestore.service';

/**
 * Script to fix figure URLs by making them publicly accessible
 */
async function fixFigureUrls() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const storageService = app.get(FirebaseStorageService);
  const firestoreService = app.get(FirestoreService);

  try {
    console.log('Fixing figure URLs...');

    // Get all courses
    const coursesSnapshot = await firestoreService.getFirestore()
      .collection('courses')
      .get();

    let totalFigures = 0;
    let fixedFigures = 0;

    for (const courseDoc of coursesSnapshot.docs) {
      const course = courseDoc.data();
      const courseId = courseDoc.id;
      let courseUpdated = false;

      // Check figures at course level
      if (course.figures && Array.isArray(course.figures)) {
        for (const figure of course.figures) {
          totalFigures++;
          if (figure.imageUrl && !figure.imageUrl.includes('googleapis.com')) {
            // This is likely a path, not a URL
            try {
              const publicUrl = await storageService.getPublicUrl(figure.imageUrl);
              figure.imageUrl = publicUrl;
              courseUpdated = true;
              fixedFigures++;
              console.log(`Fixed figure URL for course ${courseId}: ${publicUrl}`);
            } catch (error) {
              console.error(`Failed to fix figure URL: ${figure.imageUrl}`, error);
            }
          }
        }
      }

      // Check figures in modules/lessons
      if (course.modules && Array.isArray(course.modules)) {
        for (const module of course.modules) {
          if (module.lessons && Array.isArray(module.lessons)) {
            for (const lesson of module.lessons) {
              if (lesson.figures && Array.isArray(lesson.figures)) {
                for (const figure of lesson.figures) {
                  totalFigures++;
                  if (figure.imageUrl && !figure.imageUrl.includes('googleapis.com')) {
                    try {
                      const publicUrl = await storageService.getPublicUrl(figure.imageUrl);
                      figure.imageUrl = publicUrl;
                      courseUpdated = true;
                      fixedFigures++;
                      console.log(`Fixed figure URL in lesson: ${publicUrl}`);
                    } catch (error) {
                      console.error(`Failed to fix figure URL: ${figure.imageUrl}`, error);
                    }
                  }
                }
              }
            }
          }
        }
      }

      // Update the course if any figures were fixed
      if (courseUpdated) {
        await courseDoc.ref.update(course);
        console.log(`Updated course ${courseId} with fixed figure URLs`);
      }
    }

    console.log(`\nFixed ${fixedFigures} out of ${totalFigures} figure URLs`);
  } catch (error) {
    console.error('Error fixing figure URLs:', error);
  } finally {
    await app.close();
  }
}

// Run the script
fixFigureUrls().catch(console.error);