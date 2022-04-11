import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnInit,
  TemplateRef,
  ViewChild
} from '@angular/core';
import {BehaviorSubject, combineLatest, map, Observable, shareReplay, startWith} from 'rxjs';
import {DriveItem, FilterMethod} from 'definitions';
import {DbService} from '../../../../../../shared/services/db/db.service';
import {FormControl} from '@angular/forms';
import {debounceTime, switchMap, take, tap} from 'rxjs/operators';
import {MatDialog} from '@angular/material/dialog';
import {NoopScrollStrategy} from '@angular/cdk/overlay';
import {disableScroll, enableScroll} from '@shared/utils/scroll';
import {FullFilePreviewComponent} from '../full-file-preview/full-file-preview.component';
import {getStorage, ref} from '@angular/fire/storage';
import {FbStorageService} from '../../../../../../../../integrations/firebase/fb-storage.service';
import {HttpClient, HttpEventType} from '@angular/common/http';
import {saveAs} from 'file-saver';
import {random} from '@jaspero/utils';
import {DriveService} from '../../services/drive/drive.service';
import {ActivatedRoute, NavigationExtras, Router} from '@angular/router';

@Component({
  selector: 'jms-drive',
  templateUrl: './drive.component.html',
  styleUrls: ['./drive.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DriveComponent implements OnInit {

  @Input()
  title = 'Drive';
  items$: Observable<{
    folders: DriveItem[],
    files: DriveItem[]
  }>;
  routeControl: FormControl;

  view: 'list' | 'grid' = 'grid';

  @ViewChild('context')
  contextTemplate: TemplateRef<any>;

  loading$ = new BehaviorSubject(true);

  constructor(
    public drive: DriveService,
    public activatedRoute: ActivatedRoute,
    private db: DbService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {
  }

  ngOnInit(): void {
    this.routeControl = new FormControl('');

    this.activatedRoute.data.pipe().subscribe((data) => {
      const routes = (data as any)?.route || [];
      this.routeControl.setValue(routes.join('/'));
    });

    this.items$ = this.routeControl.valueChanges.pipe(
      debounceTime(500),
      startWith(this.routeControl.value),
      switchMap((route) => {
        this.loading$.next(true);

        return combineLatest([
          this.getItems(route, 'folder'),
          this.getItems(route, 'file')
        ]);
      }),
      map(([folders, files]) => {
        return {
          folders,
          files
        };
      }),
      shareReplay(1),
      tap((a) => {
        this.loading$.next(false);
        this.cdr.markForCheck();
      })
    );
  }

  getItems(route: string, type?: 'file' | 'folder'): Observable<DriveItem[]> {

    const filters = [
      {
        key: 'path',
        operator: FilterMethod.Equal,
        value: route || '.'
      }
    ];

    if (type) {
      filters.push({
        key: 'type',
        operator: FilterMethod.Equal,
        value: type
      });
    }

    return this.db.getValueChanges(
      'drive',
      undefined,
      undefined,
      undefined,
      filters
    );
  }

  toggleView() {
    this.view = this.view === 'grid' ? 'list' : 'grid';
  }

  openItemContextMenu(event: MouseEvent, item: DriveItem) {
    event.preventDefault();
    event.stopPropagation();

    (event.target as HTMLDivElement).closest('.mat-card').classList.add('active');
    disableScroll();

    this.dialog.open(this.contextTemplate, {
      autoFocus: false,
      width: '140px',
      position: {
        top: event.clientY + 'px',
        left: event.clientX + 'px'
      },
      backdropClass: 'clear-backdrop',
      panelClass: 'contextmenu-dialog',
      data: {
        item
      },
      scrollStrategy: new NoopScrollStrategy()
    }).afterClosed().pipe(
      take(1),
      tap(() => {
        (event.target as HTMLDivElement).closest('.mat-card').classList.remove('active');
        enableScroll();
      })
    ).subscribe();
  }

  previewItem(item: DriveItem) {
    disableScroll();

    this.dialog.open(FullFilePreviewComponent, {
      maxWidth: '100vw',
      maxHeight: '100vh',
      height: '100%',
      width: '100%',
      panelClass: 'full-screen-dialog',
      data: {
        item
      },
      scrollStrategy: new NoopScrollStrategy()
    }).afterClosed().pipe(
      take(1),
      tap(() => {
        enableScroll();
      })
    ).subscribe();
  }

  uploadItems(files: FileList) {
    console.log(files);
  }

  navigateTo(item: DriveItem, append = false) {
    const route = this.routeControl.value;
    const path = (
      (it: string) => it.startsWith('/') ? it.slice(1) : it
    )(route === '.' ? item.name : `${route}/${item.name}`).split('/').filter(it => !!it);

    const extras: NavigationExtras = {};

    if (append) {
      path.unshift('drive');
    } else {
      path.splice(0, path.length);
      path.push('drive');
      if (item.name) {
        path.push(item.name);
      }
    }

    this.router.navigate(path, extras);
  }

  mouseEnterDownload(download: DriveItem) {
    (download as any).hover = true;
    (download as any).icon = 'cancel';
    (download as any).iconColor = '#757575';
  }

  mouseLeaveDownload(download: DriveItem) {
    (download as any).hover = false;
    (download as any).icon = '';
    (download as any).iconColor = '';
  }
}
