import {ChangeDetectionStrategy, Component} from '@angular/core';
import {FieldData} from '../../../interfaces/field-data.interface';
import {FieldComponent} from '../../field/field.component';

interface InputData extends FieldData {
  type: 'text' | 'number' | 'email';
  autocomplete?: string;
}

@Component({
  selector: 'jms-input',
  templateUrl: './input.component.html',
  styleUrls: ['./input.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InputComponent extends FieldComponent<InputData> {}
