import { Course } from './question';

export interface Class extends Course {
    courseCode?: string | null;
    subject?: string | null;
}
